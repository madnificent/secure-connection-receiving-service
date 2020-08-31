// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, errorHandler } from 'mu';
import fs from 'fs';
import net from 'net';
import { spawn } from 'child_process';
import http from 'http';

// DANGER: removing processors we do not want from the template here
app._router.stack = removeStackPreProcessors( app._router.stack );

app.get('/self', async function( req, res ) {
  const bodyFile = "/data/incomingRequestGpg.txt";
  const target = "/secure";
  const encryptedResponseFile = "/data/responseGpg.txt";
  const decryptedResponseFile = "/data/response.txt";

  fs.readFile(bodyFile, 'binary', (err, bodyContent) => {
    let response = "";

    if( err )
      console.log("Oh noes terrible stuffs happened, could not read file");

    let content =
        Buffer
        .from(bodyContent, 'binary')
        .toString('base64');

    http
      .request({
        hostname: "localhost",
        port: 80,
        path: target,
        method: "POST",
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': Buffer.byteLength(content)
        }
      }, (req) => {
        req
          .on('data', (d) => response += d )
          .on('end', () => {
            console.log(`Got BASE64 response:\n${response}`);
            const encryptedResponse = Buffer.from(response, 'base64');
            console.log(`Got ENCRYPTED response:\n${encryptedResponse.toString('binary')}`);
            fs.writeFile(encryptedResponseFile, encryptedResponse, (err) => {
              const gpgDecryptChildProcess =
                    spawn('gpg', ['--output', decryptedResponseFile,
                                  '--decrypt', encryptedResponseFile]);
              gpgDecryptChildProcess.stderr.on('data', (err) => console.log(`Decrypt request error: ${err.toString()}`));
              gpgDecryptChildProcess.stdout.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
              gpgDecryptChildProcess.on('close', () => {
                fs.readFile(decryptedResponseFile, 'utf8', (err, decryptedResponse) => {
                  if ( err )
                    console.log("Something went wrong reading the decrypted response");
                  res.connection.write( decryptedResponse );
                  res.end();
                });
              });
            });
          });})
      .write( content );
  });
});

app.post('/secure', async function( req, res ) {
  let body = '';
  req.on('data', (data) => body += data );
  req.on('end', async (data) => {
    // const headers = forwardedHeadersAsString(req.headers);
    // const incomingFileBody = `${headers}\r\n${body}`;

    // write the data to a file
    // const incomingFilePath = "/data/incomingRequest.txt";
    // fs.writeFile( incomingFilePath, incomingFileBody,
    //               (err) => {
    //                 if( err ) {
    //                   console.log(err);
    //                 }
    //               } );

    const incomingGpgBodyPath = "/data/incomingBodyGpg.txt";
    const decryptedBodyPath = "/data/outgoingRequest.txt";

    fs.writeFile(
      incomingGpgBodyPath,
      Buffer.from(body, 'base64'),
      (err) => {
        if( err ) {
          console.log(`Could not write body stream ${err}`);
        }
        // decrypt the body
        const gpgDecryptChildProcess =
              spawn('gpg', ['--output', decryptedBodyPath,
                            '--decrypt', incomingGpgBodyPath]);
        gpgDecryptChildProcess.stderr.on('data', (err) => console.log(`Decrypt request error: ${err.toString()}`));
        gpgDecryptChildProcess.stdout.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
        gpgDecryptChildProcess.on('close', () => {
          // send out a request
          fs.readFile( decryptedBodyPath, 'utf8', (err, outgoingFileBody) => {
            if( err ) {
              console.log(`An error occurred whilst reading the request: ${err}`);
            } else {
              console.log(`We got a decrypted file body. \n${outgoingFileBody}`);

              const fixedHeader = "GET /nothing HTTP/1.1\r\nHost: identifier\r\nAccept-Encoding: identity\r\nConnection: close";
              const rawHttpRequest = `${fixedHeader}\r\n${outgoingFileBody}`;

              console.log(rawHttpRequest);

              const client = new net.Socket();
              let receivedData = "";
              client
                .connect( 80, "identifier", () => {
                  // client.write( `${firstLine}\n${secondLine}\n${fileBody}` );
                })
                .on('connect', () => client.write(rawHttpRequest))
              // Pipe the response
                .on('data', (d) => {
                  // NOTE: not sure how supported this is, but we want to write
                  // the raw content and this seems to be the way to go about
                  // it.
                  receivedData += d.toString();
                  // res.connection.write(d.toString());
                })
                .on('close', async () => {
                  console.log("CLOSED CONNECTION");
                  const encryptedResponseFile = '/data/encryptedResponseFromProducer.txt';
                  const nakedResponseFile = '/data/nakedResponseFromProducer.txt';
                  fs.writeFile(
                    nakedResponseFile, receivedData,
                    (err) => {
                      if( err )
                        console.log(`error writing file: ${err}`);
                      else {
                        console.log("Wrote file");
                        const child =
                              spawn('gpg', ['--recipient', 'secureproducer@redpencil.io',
                                            '-o', encryptedResponseFile,
                                            '--encrypt', nakedResponseFile]);
                        // child.on('close', () =>
                        //   res.download(encryptedResponseFile, 'encrypted.txt.gpg')
                        // );
                        child.on('close', () =>
                          fs.readFile( encryptedResponseFile, 'binary', (err, encryptedBody) => {
                            if( err )
                              console.log(`Could not fully read encrypted body in producer: ${err}`);
                            res.set('Content-Type', 'application/octet-stream');
                            const responseString = Buffer.from(encryptedBody, 'binary').toString('base64');
                            console.log(`Sending BASE64 response string:\n${responseString}\n`);
                            console.log(`THIS IS BINARY response string:\n${encryptedBody}`);
                            res.set('Content-Length', Buffer.byteLength( responseString ));
                            res.send( responseString );
                            res.end();
                          }));
                      }
                    });
                })
                .on('error', () => {
                  res.end();
                  console.log("AN ERROR OCCURRED");
                });
            }
          });
        });
      });
  });
});

app.use(errorHandler);


/**
 * Yields a new stack with the undesired elements removed.
 *
 * DANGER: This depends on mu-javascript-template internals !DANGER!
 *
 * This means we have to remove jsonParser, urlencodedParser, the
 * thing that sets the JSONAPI type next to it, [the
 * httpContext.middleware can stay], the following anonymous function
 * too.
 *
 * Our approach for removing this is to find the jsonparse and remove
 * it.  Then we remove the urlencodedParser and whatever follows it.
 */
function removeStackPreProcessors( originalStack ){
  let stack = [ ...originalStack ];
  stack = stack.filter( (e) => e.name !== "jsonParser" );

  const urlEncodedParserIdx =
        stack
        .findIndex( (e) => e.name == "urlencodedParser" );

  stack = [ ...stack.slice( 0, urlEncodedParserIdx ), ...stack.slice( urlEncodedParserIdx + 2 ) ];
  return stack;
}

function forwardedHeadersAsString( headers ) {
  const ignoreList = ["host", "accept-encoding", "connection"];

  let body = "";
  for( const key in headers ) {
    if( ignoreList.includes( key.toLowerCase() ) ) {
      // skip
    } else {
      body += `${key}: ${headers[key]}\r\n`;
    }
  }
  return body;
}
