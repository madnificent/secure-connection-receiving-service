// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, errorHandler } from 'mu';
import fs from 'fs';
import { promisify } from 'util';
import net from 'net';
import { spawn } from 'child_process';
import http from 'http';

// DANGER: removing processors we do not want from the template here
app._router.stack = removeStackPreProcessors( app._router.stack );

const ACCEPTED_SENDERS = ["secureproducer@redpencil.io", "securerequester@redpencil.io"];

const readFileP = promisify( fs.readFile );
const writeFileP = promisify( fs.writeFile );
const unlinkP = promisify( fs.unlink );

app.get('/self', async function( _req, res ) {
  const bodyFile = "/data/incomingRequestGpg.txt";
  const target = "/secure";
  const encryptedResponseFile = "/data/responseGpg.txt";
  const decryptedResponseFile = "/data/response.txt";

  await removeFiles( encryptedResponseFile, decryptedResponseFile );

  try {
    const bodyContent = await readFileP( bodyFile, 'binary' );
    let response = "";

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
          'Content-Length': Buffer.byteLength(content),
          'Mu-Secure-Sender': 'securerequester@redpencil.io'
        }
      }, (req) => {
        req
          .on('data', (d) => response += d )
          .on('end', async () => {
            if( req.statusCode != 200 ) {
              console.log(`Server sent status code ${req.statusCode}`);
            } else {
              try {
                // console.log(`Got BASE64 response:\n${response}`);
                const encryptedResponse = Buffer.from(response, 'base64');
                // console.log(`Got ENCRYPTED response:\n${encryptedResponse.toString('binary')}`);
                await writeFileP( encryptedResponseFile, encryptedResponse );
                await decrypt({
                  source: encryptedResponseFile,
                  target: decryptedResponseFile,
                  sender: 'secureproducer@redpencil.io'
                });
                const decryptedResponse = await readFileP( decryptedResponseFile, 'utf8' );
                res.connection.write( decryptedResponse );
                res.end();
              } catch(e) {
                console.log(`Something went wrong decrypting the message: ${e}`);
              }
            }
          });})
      .write( content );
  } catch (e) {
    console.log(`An error occurred ${e}`);
  }
});

app.post('/secure', async function( req, res ) {
  let body = '';

  // received request
  const incomingGpgBodyPath = "/data/incomingBodyGpg.txt";
  const decryptedBodyPath = "/data/outgoingRequest.txt";

  // response to send
  const encryptedResponseFile = '/data/encryptedResponseFromProducer.txt';
  const nakedResponseFile = '/data/nakedResponseFromProducer.txt';

  await removeFiles( incomingGpgBodyPath, decryptedBodyPath, encryptedResponseFile, nakedResponseFile );

  req.on('data', (data) => body += data );
  req.on('end', async (_data) => {
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

    try {
      const sender = req.get('mu-secure-sender');

      if( !ACCEPTED_SENDERS.includes( sender ) ){
        console.log(`SENDER ${sender} IS NOT ACCEPTED`);
        res.status(500).end("No response");
        return;
      }

      await writeFileP( incomingGpgBodyPath, Buffer.from(body, 'base64') );

      // decrypt the body
      const gpgDecryptChildProcess =
            spawn('gpg', ['--status-fd', '2',
                          '--output', decryptedBodyPath,
                          '--decrypt', incomingGpgBodyPath]);
      // TODO: escape dots in sender
      const signatureCheckProcess =
            spawn('grep', [ '-q', `^\\\[GNUPG:\\\] GOODSIG .* <${sender}>` ]);
      gpgDecryptChildProcess.stderr.pipe(signatureCheckProcess.stdin);
      // gpgDecryptChildProcess.stdout.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
      // ENABLING THIS BREAKS APP!
      // gpgDecryptChildProcess.stderr.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
      signatureCheckProcess.on('exit', async (code) => {
        if( code != 0 ) {
          console.log(`It seems ${sender} did not sign this message`);
          res.status(500).send("Could not decrypt message");
        } else {
          console.log(`Valid signature of ${sender} is valid`);
          // send out a request
          const outgoingFileBody = await readFileP( decryptedBodyPath, 'utf8' );
          console.log(`We got a decrypted file body. \n${outgoingFileBody}`);

          const fixedHeader = "GET /nothing HTTP/1.1\r\nHost: identifier\r\nAccept-Encoding: identity\r\nConnection: close";
          const rawHttpRequest = `${fixedHeader}\r\n${outgoingFileBody}`;
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
            })
            .on('close', async () => {
              try {
                console.log("CLOSED CONNECTION");
                await writeFileP( nakedResponseFile, receivedData );
                console.log("Wrote file");
                try {
                  await encrypt({
                    receiver: sender,
                    sender: "secureproducer@redpencil.io",
                    source: nakedResponseFile,
                    target: encryptedResponseFile
                  });

                  console.log("Closed process");
                  const encryptedBody = await readFileP( encryptedResponseFile, 'binary' );
                  res.set('Content-Type', 'application/octet-stream');
                  const responseString = Buffer.from(encryptedBody, 'binary').toString('base64');
                  // console.log(`Sending BASE64 response string:\n${responseString}\n`);
                  // console.log(`THIS IS BINARY response string:\n${encryptedBody}`);
                  res.set('Content-Length', Buffer.byteLength( responseString ));
                  res.send( responseString );
                  res.end();
                } catch (e) {
                  console.log(`Something went wrong encrypting or sending body: ${e}`);
                }
              } catch (e) {
                console.log(`Something went wrong when processing the response of the backend: ${e}`);
              }
            })
            .on('error', () => {
              res.end();
              console.log("AN ERROR OCCURRED");
            });
        }
      });
    } catch (e) {
      console.log(`Something weird happened: ${e}`);
    }
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

//////////////////
// FILE MANAGEMENT
//////////////////

/**
 * Removes a file, ignoring errors which happen when trying to remove
 * it.
 */
async function removeFile( file ) {
  try {
    await unlinkP( file );
  } catch(e) { }
}

/**
 * Removes a set of files.
 */
async function removeFiles( ...files ) {
  for( const file of files )
    await removeFile( file );
}


/////////////////////////
// ENCRYPTION AND SIGNING
/////////////////////////

/**
 * Encrypts and signs with the supplied details.
 */
function encrypt({ source, target, sender, receiver }){
  return new Promise( (res, rej) => {
    try {
      const child =
            spawn('gpg', ['--sign', '--local-user', sender,
                          '--recipient', receiver,
                          '--output', target,
                          '--encrypt', source]);
      // gpg --sign --local-user $2 --recipient $1 --output /app/$4 --encrypt /app/$3

      // console.log("Launched child process");
      child.on('close', async () => {
        // if( code != 0 )
        //   rej(`It seems something went wrong whilst encrypting the message`);
        // else
          res();
      });
    } catch (e) { rej(`Something went wrong with the child process: ${e}`); }
  });
}

/**
 * Decrypts and verifies the signature.
 */
function decrypt({ source, target, sender }) {
  return new Promise( (res, rej) => {
    try {
      const gpgDecryptChildProcess =
            spawn('gpg', ['--status-fd', '2',
                          '--output', target,
                          '--decrypt', source]);
      // TODO: escape dots in sender
      const signatureCheckProcess =
            spawn('grep', [ '-q', `^\\\[GNUPG:\\\] GOODSIG .* <${sender}>` ]);
      gpgDecryptChildProcess.stderr.pipe(signatureCheckProcess.stdin);
      // gpgDecryptChildProcess.stdout.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
      // ENABLING THIS BREAKS APP!
      // gpgDecryptChildProcess.stderr.on('data', (out) => console.log(`Decrypt request info: ${out.toString()}`));
      signatureCheckProcess.on('exit', async (code) => {
        if( code != 0 )
          rej(`It seems ${sender} did not sign this message`);
        else
          res();
      });
    } catch(e) {
      rej(`Something went haywire during the decryption: ${e}`);
    }
  });
}
