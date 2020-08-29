// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, errorHandler } from 'mu';
import fs from 'fs';

// DANGER: removing processors we do not want from the template here
app._router.stack = removeStackPreProcessors( app._router.stack );

app.post('/secure', function( req, res ) {
  let body = '';
  req.on('data', (data) => body += data );
  req.on('end', (data) => {
    const filePath = "/data/request.txt";
    const headers = headersToString(req.rawHeaders);
    body = `${headers}\n${body}`;
    fs.appendFile( filePath, body,
                   () => res.send("Wrote to disk"),
                   (err) => {
                     if( err ) {
                       console.log(err);
                       res.send("Booboo");
                     }
                   } );
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

function headersToString( headers ) {
  let isLabel = true; // true for labels, false for their values
  let body = "";
  for( const value of headers ) {
    if( isLabel )
      body += `${value}: `;
    else
      body += `${value}\n`;

    isLabel = !isLabel;
  }
  return body;
}
