// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, errorHandler } from 'mu';
import fs from 'fs';
import net from 'net';

// DANGER: removing processors we do not want from the template here
app._router.stack = removeStackPreProcessors( app._router.stack );

app.post('/secure', async function( req, res ) {
  let body = '';
  req.on('data', (data) => body += data );
  req.on('end', async (data) => {
    const headers = forwardedHeadersAsString(req.headers);
    const incomingFileBody = `${headers}\r\n${body}`;

    // write the data to a file
    const incomingFilePath = "/data/incomingRequest.txt";
    fs.writeFile( incomingFilePath, incomingFileBody,
                  (err) => {
                    if( err ) {
                      console.log(err);
                    }
                  } );

    // send out a request
    const outgoingFilePath = "/data/outgoingRequest.txt";
    fs.readFile( outgoingFilePath, 'utf8', (err, outgoingFileBody) => {
      if( err ) {
        console.log(`An error occurred whilst reading the request: ${err}`);
      } else {
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
            res.connection.write(d.toString());
          })
          .on('close', () => {
            res.end();
            console.log("CLOSED CONNECTION");
            fs.writeFile( "/data/incomingResponse.txt", receivedData,
                          (err) => err
                          ? console.log(`error writing file: ${err}`)
                          : console.log("Wrote file") );
          })
          .on('error', () => {
            res.end();
            console.log("AN ERROR OCCURRED");
          });
      }
    });
  });
} );

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
