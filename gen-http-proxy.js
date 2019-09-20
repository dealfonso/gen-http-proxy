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

// IP address in which the server will listen
var address = process.env['address'] || "0.0.0.0";

// Port in which the server will listen
var port = process.env['port'] || '443';

// A token to have access to the server (disabled if set to blank). If no token provided, a random one will be generated
var token = process.env['token'];
if (token === undefined) token = require('crypto').randomBytes(16).toString('hex');

// Key file and Certificate file for the HTTPS server
var keyfile = process.env['key'] || './server.key';
var certfile = process.env['cert'] || './server.crt';

// A timeout for the session (default has no timeout)
var sessiontimeout = normalizeNumber(process.env['sessiontimeout'] || '-1');

// The target server (provided in the form <ip>:<address>; the default value is localhost:3000)
var target = process.env['target'] || 'localhost:3000';
target = target.split(':');
var target = {
  host: target[0] || 'localhost',
  port: normalizeNumber(target[1] || '3000')
};

// The authentication function needs a token. If not provided in the URL, it will be obtained from a cookie. When the token is set to valid
//   the value will be stored in the cookie so that it is not needed to pass the token in the URL again
function checkauth(req, res) {
  var cookies = new Cookies(req, res);
  var stored_token = cookies.get('token');
  var options = {};

  // If a session timeout is set, will create the options for the cookies
  if (sessiontimeout > 0) options = {maxAge: sessiontimeout * 1000};

  // If the token is set to blank, the authentication is disabled
  if (token === "") return true;

  if (stored_token == token) {

    // If the token in the cookie is valid, let's use it
    cookies.set('token', token, options);
    return true;
  }

  // If there is not a valid token, let's get it from the URL
  var query = url.parse(req.url, true).query;
  if ((query.token === undefined) || (query.token != token)) {
    res.statusCode = 401;

    // Show a simple form to be able to provide the token
    res.end('<html><form method="get"><label for="token">token:</label><input type="text" id="token" name="token"><input type="submit" value="login"></form></html>');
    return false;
  }

  // If arrived up to here, will set the cookie with the valid token
  cookies.set('token', token, options);
  return true;
}

// The handler simply checks for the authentication and proxies the results to the server
var handler = function (req, res) {
  if (checkauth(req,res))
    proxy.web(req, res);
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
  if (sessiontimeout > 0) console.log('expiration: %d', sessiontimeout);
});

// Start the server
server.listen(port, address);