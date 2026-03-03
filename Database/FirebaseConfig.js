const Firebase = require('firebase-admin');
const ServiceAccount = require('../APIService/ServiceAccountKey.json');

Firebase.initializeApp({
    credential: Firebase.credential.cert(ServiceAccount),
    databaseURL: "https://app-backend-6477f-default-rtdb.firebaseio.com"
});

const db = Firebase.firestore();

module.exports = db; 
