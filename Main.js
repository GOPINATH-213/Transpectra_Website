const express = require('express');
const path = require('path');
const hbs = require('hbs');
const cookie = require('cookie-parser');
const fs = require("fs");
const cors = require("cors");
const session = require('express-session');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './Public')));
app.set('view engine', 'hbs');
hbs.registerPartials(path.join(__dirname, "./Views/Partials"));
hbs.registerHelper('eq', function (a, b) {
  return a === b;
});
hbs.registerHelper('inc', function (value) {
  return parseInt(value) + 1;
});
hbs.registerHelper('ifOr', function (arg1, arg2, options) {
  return (arg1 || arg2) ? options.fn(this) : options.inverse(this);
});
hbs.registerHelper('encodeURIComponent', function (str) {
  return encodeURIComponent(str);
});
app.use(cookie());

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

app.use(session({
  secret: 'GHOST_OF_RAMPAGE',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set true if using https
}));

app.use('/', require('./Routers/Pages'));
app.use('/Auth', require('./Routers/Auth'));

app.listen(1000, () => {
  console.log("Server is Running");
});