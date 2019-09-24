#! /usr/bin/env node
/* 

 gen-http-proxy - Generic http(s) proxy with token authentication

 https://github.com/dealfonso/gen-http-proxy

 Copyright (C) GRyCAP - I3M - UPV
 Developed by Carlos A. caralla@upv.es

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.

*/

const httpProxy = require('http-proxy');
const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const Cookies = require('cookies');
const path = require('path');

// Function that safely converts a string to a number
function normalizeNumber(val) {
  var port = parseInt(val, 10);
  if (isNaN(port)) return val;
  if (port >= 0)  return port;
  return false;
}

// Whether to use https or http. The usage of a token is independent from this setting
var secure = process.env['secure'] || "false";
secure = (secure == "true" || secure == "1");

// A token to have access to the server (disabled if set to blank). If no token provided, a random one will be generated
var token = process.env['token'];
if (token === undefined) token = require('crypto').randomBytes(16).toString('hex');

// Key file and Certificate file for the HTTPS server
var keyfile = process.env['key'] || './server.key';
var certfile = process.env['cert'] || './server.crt';

// Use cookies for authentication or not
var usecookies = process.env['usecookies'] || "true";
usecookies = (usecookies == "true" || usecookies == "1");

// A timeout for the session (default 60 seconds)
var sessiontimeout = normalizeNumber(process.env['sessiontimeout'] || '60');

// Use a static server (to serve files under the <staticfolder> folder)
var staticserver = process.env['staticserver'] || "true";
staticserver = (staticserver == "true" || staticserver == "1");

// If enabling the static server, which folder should serve
var staticfolder = process.env['staticfolder'] || './static';

// The IP address and port in which the proxy has to listen
var listen = process.env['server'] || '0.0.0.0:10000';

// The target server (provided in the form <ip>:<address>; the default value is localhost:3000)
var target = process.env['target'] || 'localhost:3000';

// If there is a single argument
var args = process.argv.slice(2);
if (args.length == 1)
    // The first argument will be the target, and will have precedence over the env var
    target = args[0];
else if (args.length == 2) {
    listen = args[0];
    target = args[1];
}
else if (args.length != 0) {
    console.log('usage: gen-http-proxy.js [ <target> ]');
    return -1;
}

target = target.split(':');
target = {
  host: target[0] || 'localhost',
  port: normalizeNumber(target[1] || '3000')
};

listen = listen.split(':');
listen = {
  host: listen[0] || '0.0.0.0',
  port: normalizeNumber(listen[1] || '10000')
};


// The authentication function needs a token. If not provided in the URL, it will be obtained from a cookie. When the token is set to valid
//   the value will be stored in the cookie so that it is not needed to pass the token in the URL again
function checkauth(req, res) {
  var cookies = new Cookies(req, res);
  var stored_token = null;
  var options = {};

  if (usecookies) {
    stored_token = cookies.get('token');
    // If a session timeout is set, will create the options for the cookies
    if (sessiontimeout > 0) options = {maxAge: sessiontimeout * 1000};
  }

  // If the token is set to blank, the authentication is disabled
  if (token === "") return true;

  if (stored_token != token) {
    // If there is not a valid token, let's get it from the URL
    var query = url.parse(req.url, true).query;
    if ((query.token === undefined) || (query.token != token))
      return false;
  }

  // If arrived up to here, will set the cookie with the valid token
  if (usecookies)
    cookies.set('token', token, options);

  return true;
}

function servestatic(req, res) {
  // Partly taken from https://stackoverflow.com/a/29046869

  // parse URL
  const parsedUrl = url.parse(req.url);
  // extract URL path
  let pathname = `${staticfolder}/${parsedUrl.pathname}`;
  // based on the URL path, extract the file extention. e.g. .js, .doc, ...
  const ext = path.parse(pathname).ext;
  // maps file extention to MIME typere
  const map = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword'
  };

  fs.exists(pathname, function (exist) {
    if(!exist || fs.statSync(pathname).isDirectory()) {
      // if the file is not found, return 404
      res.statusCode = 301;
      res.setHeader('Location', '/login.html');
      res.end();
      return;
    }

    // read file from file system
    fs.readFile(pathname, function(err, data){
      if(err){
        res.statusCode = 500;
        res.end(`Error getting the file: ${err}.`);
      } else {
        // if the file is found, set Content-type and send data
        res.setHeader('Content-type', map[ext] || 'text/plain' );
        res.end(data);
      }
    });
  });
}

// The handler simply checks for the authentication and proxies the results to the server
var handler = function (req, res) {
  if (checkauth(req,res))
    proxy.web(req, res);
  else {
    if (staticserver) 
      servestatic(req, res);
    else {
      res.statusCode = 401;
      res.end('Unauthorized');
    }
  }
};

// Create a https or a http server (depending on the options)
var server = (secure) ? 
   https.createServer({
    key: fs.readFileSync(keyfile, 'utf8'),
    cert: fs.readFileSync(certfile, 'utf8')
  }, handler) :
  http.createServer({}, handler);

// Proxy the websockets
server.on('upgrade', function (req, socket, head) {
  proxy.ws(req, socket, head);
});

// Create the proxy to the target server and port
var proxy = httpProxy.createServer({
  target: target,
  ws: true
});

// Will continue in case of target error
proxy.on('error', function(err, req, res){
  if (err) console.log(err);
  res.writeHead(500);
  res.end(`${err.code}`);
});

// Show some information when start listening
server.on('listening', function() {
  var addr = server.address();

  console.log('redirecting to %s:%d', target.host, target.port);
  console.log('access url: %s://%s:%s?token=%s', secure?'https':'http', addr.address, addr.port, token);
  console.log('token: %s', token);
  console.log('use cookies: %s', usecookies);
  if (sessiontimeout > 0) console.log('expiration: %d', sessiontimeout);
});

// Start the server
server.listen(listen.port, listen.host);