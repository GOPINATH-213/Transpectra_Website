const express = require('express');
const UserController = require('../UserController/Codes');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const Router = express.Router();


/*Router.post('/Register',UserController.Register);*/
Router.post('/Login', UserController.Login);
Router.post('/Forgot', UserController.Forgot);
Router.post('/AddBus', upload.single('Busphoto'), UserController.AddBus);
Router.post('/EditBus/:id', upload.single('Busphoto'), UserController.UpdateBus);
Router.post('/AddUser', upload.single('Driverphoto'), UserController.AddUser);
Router.post('/EditUser/:id', upload.single('Driverphoto'), UserController.UpdateUser);
Router.post('/Mileage/:id', UserController.MileageCalculation);
Router.post('/Fuel/:id', UserController.FuelDetails);
Router.post('/Service/:id', UserController.ServiceDetails);
Router.post('/Source/:id', UserController.SourceDetails);
Router.post('/Destination/:id', UserController.DestinationDetails);
Router.post('/SourceChecklist/:id', UserController.SourceChecklist);
Router.post('/DestinationChecklist/:id', UserController.DestinationChecklist);
Router.post('/TripStatus/:id', UserController.TripStatus);
Router.post('/AddRoute', UserController.AddRoute);
Router.post('/AddSummary', UserController.AddSummary);
Router.post('/DailyBusReport', UserController.BusReport);
Router.post('/upload', upload.array("images", 12),UserController.ExtractRouteData);
Router.post('/submitRoutes',UserController.SubmitRouteData);
Router.post('/send-report',UserController.SendReport);

module.exports = Router;