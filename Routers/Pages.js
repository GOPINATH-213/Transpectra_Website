const express = require('express');
const UserController = require('../UserController/Codes');
const db = require('../Database/FirebaseConfig');
const Router = express.Router();

/*Router.get('/Register',(req,res)=>{
    res.render('Register');
});*/

Router.get('/ForgotPassword', (req, res) => {
    res.render('ForgotPassword')
});

Router.get(['/', '/Login'], (req, res) => {
    res.render('Login');
});

Router.get('/Home', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('Home', { User: req.user });
    }
    else {
        return res.status(401).redirect('/Login');
    }
});

Router.get('/AddRouteUsingImg', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('AddRouteUsingIMG', { User: req.user });
    }
    else {
        return res.status(401).redirect('/Login');
    }
});

Router.get('/Profile', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('Profile', { User: req.user });
    }
    else {
        return res.status(401).redirect('/Login');
    }
});

Router.get('/Logout', (req, res) => {
    res.clearCookie('authToken');
    req.session.destroy(() => {
        return res.redirect('/Login');
    });
});

Router.get('/AddBus', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('AddBus', { User: req.user });
    }
    else {
        return res.status(201).redirect('/Login');
    }
});

Router.get('/BusDetails', UserController.VerifyToken, UserController.BusDetails);

Router.get('/EditBus/:id', UserController.VerifyToken, UserController.EditBus);

Router.get('/DeleteBus/:id', UserController.VerifyToken, UserController.DeleteBus);

Router.get('/AddUser', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('AddUser', { User: req.user });
    }
    else {
        return res.status(201).redirect('/Login');
    }
});

Router.get('/EmailSending', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('EmailSending', { User: req.user });
    }
    else {
        return res.status(201).redirect('/Login');
    }
});

Router.get('/Summary', UserController.VerifyToken, UserController.Summary);

Router.get('/DriverDetails', UserController.VerifyToken, UserController.DriverDetails);

Router.get('/EditUser/:id', UserController.VerifyToken, UserController.EditUser);

Router.get('/DeleteUser/:id', UserController.VerifyToken, UserController.DeleteUser);

Router.get('/ViewBus/:id', UserController.VerifyToken, UserController.ViewBus);

Router.get('/Route', UserController.VerifyToken, UserController.Route);

Router.get('/Dashboard', UserController.VerifyToken, UserController.Dashboard);

Router.get('/BusReport', UserController.VerifyToken, (req, res) => {
    if (req.user) {
        res.render('Bus_Reports', { User: req.user });
    }
    else {
        return res.status(201).redirect('/Login');
    }
});
module.exports = Router;