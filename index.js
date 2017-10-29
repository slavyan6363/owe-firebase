"use strict";


const oweNotFoundCode = 500;
const ignoreNotFoundOweIds = true;

const userIdNotFoundCode = 500;
const ignoreNotFoundUserIds = true;

const phoneNotFoundErrorCode = 400;

const OWE_STATUS_REQUESTED = 'requested'
const OWE_STATUS_ACTIVE = 'active'
const OWE_STATUS_CLOSED = 'closed'
const OWE_STATUS_CANCELLED = 'cancelled'
const OWE_STATUS_REQUESTED_CLOSE = 'requested_close'

const functions = require('firebase-functions');

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//
// exports.helloWorld = functions.https.onRequest((request, response) => {
//  response.send("Hello from Firebase!");
// });

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);


///==================== checking auth =====================
const express = require('express');
const cookieParser = require('cookie-parser')();
const cors = require('cors')({origin: true});
const app = express();

// '+7(922)016-55-27' -> '89220165527'
const phoneNumberToDigits = (phoneNumber) => {
  return phoneNumber.replace( /^\+7/, '8' ).replace( /[^\d\+]/g, '' )
}

// Express middleware that validates Firebase ID Tokens passed in the Authorization HTTP header.
// The Firebase ID token needs to be passed as a Bearer token in the Authorization HTTP header like this:
// `Authorization: Bearer <Firebase ID Token>`.
// when decoded successfully, the ID Token content will be added as `req.user`.
const validateFirebaseIdToken = (req, res, next) => {
  //console.log('Check if request is authorized with Firebase ID token');

  if ((!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) &&
      !req.cookies.__session) {
    console.error('No Firebase ID token was passed as a Bearer token in the Authorization header.',
        'Make sure you authorize your request by providing the following HTTP header:',
        'Authorization: Bearer <Firebase ID Token>',
        'or by passing a "__session" cookie.');
    res.status(401).send('Unauthorized');
    return;
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    console.log('Found "Authorization" header');
    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split('Bearer ')[1];
  } else {
    console.log('Found "__session" cookie');
    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  }
  admin.auth().verifyIdToken(idToken).then(decodedIdToken => {
    console.log('ID Token correctly decoded', decodedIdToken);
    req.user = decodedIdToken;

    next();

    admin.database().ref(`/users/${req.user.uid}/name/`).set(req.user.name);
    admin.database().ref(`/users/${req.user.uid}/photo/`).set(req.user.picture);
    admin.database().ref(`/users/${req.user.uid}/email/`).set(req.user.email);
    admin.database().ref(`/users/${req.user.uid}/lastRequest/`).set(Date.now());
  }).catch(error => {
    console.error('Error while verifying Firebase ID token:', error);
    res.status(401).send('Unauthorized');
  });
};

app.use(cors);
app.use(cookieParser);
app.use(validateFirebaseIdToken);
app.get('/hello', (req, res) => {
  res.send(`Hello ${req.user.name}`);
});


///========================================================

// Take the text parameter passed to this HTTP endpoint and insert it into the
// Realtime Database under the path /messages/:pushId/original
// exports.addMessage = functions.https.onRequest((req, res) => {
//   // Grab the text parameter.
//   const original = req.query.text;
//   // Push the new message into the Realtime Database using the Firebase Admin SDK.
//   admin.database().ref('/messages').push({original: original}).then(snapshot => {
//     // Redirect with 303 SEE OTHER to the URL of the pushed object in the Firebase console.
//     res.redirect(303, snapshot.ref);
//   });
// });









var changeOweStatusUnsafe = function(oweObject, newStatus) {
  console.log(`Changing OWE ${oweObject.id} status from ${oweObject.status} to ${newStatus}`)

  admin.database().ref(`/users/${oweObject.who}/owes/${oweObject.status}/${oweObject.id}/`).remove()
  admin.database().ref(`/users/${oweObject.to}/owes/${oweObject.status}/${oweObject.id}/`).remove()
  admin.database().ref(`/users/${oweObject.who}/owes/${newStatus}/${oweObject.id}/`).set(true)
  admin.database().ref(`/users/${oweObject.to}/owes/${newStatus}/${oweObject.id}/`).set(true)

  admin.database().ref(`/owes/${oweObject.id}/status`).set(newStatus);

  if (newStatus == OWE_STATUS_CLOSED) {
    admin.database().ref(`/owes/${oweObject.id}/closed`).set(Date.now());
  }
}











app.get('/addOwe', (req, res) => {
  console.log('addOwe');
  
  // phone number
  var who = phoneNumberToDigits(req.query.who);
  // phone number
  var to = phoneNumberToDigits(req.query.to);
  const sum = req.query.sum;
  const descr = req.query.descr;
  var counter = 0;
  
  //function to wait async completion of finding two UIDs of users by their phone numbers
  var sendResIfBothFound = function() {
    ++counter;
    if(counter == 2) {
      // we are not allowing to create an OWE between two users if no one of them is you
      if (who !== req.user.uid && to !== req.user.uid) {
        console.log(req.user.uid + " req for " + who + " " + to)
        res.sendStatus(403);
        return;
      }

      //if requster is the debtor then we don't need any confirmations by the creditor
      var status = who == req.user.uid ? OWE_STATUS_ACTIVE : OWE_STATUS_REQUESTED;

      //push new OWE object and get it's db key
      var oweKey = admin.database().ref(`/owes`).push({
      	who: who, 
      	to: to, 
      	sum: sum, 
      	descr: descr,
      	status: status,
      	created: Date.now(),
      	closed: 0
      }).key;

      //add oweKey to users who should know about this OWE
      admin.database().ref(`/users/${who}/owes/${status}/${oweKey}`).set(true)
      admin.database().ref(`/users/${to}/owes/${status}/${oweKey}`).set(true)

      //return new OWE key with status SUCCESS
      res.status(200).send({ 
        result: 'Successfully added new OWE object, see \'oweId\' field for it\'s id.', 
        oweId: oweKey 
      });
    }
  }

  // IF NOTHING FOUND     snapshot.val()    WILL BE    null
  var isBadPhone = function(snapshot, found) {
    const val = snapshot.val();

    if (val == null) {
      if (!res.headerSent) {
        res.status(phoneNotFoundErrorCode).send({ 
          error : { 
            code : phoneNotFoundErrorCode,
            message : `User with specified number '${found.id}' is not registered.`,
            number : found.id
          }
        });
      }
    }
    else {
      found.id = Object.keys(val)[0]
    }

    return (val == null)
  }

  admin.database().ref('/users').orderByChild('phone').equalTo(who).once("value", function(snapshot) {
  	//found object is here just to pass it to function isBadPhone by reference
    var found = { id : who };
    if (!isBadPhone(snapshot, found)) {
      who = found.id
      sendResIfBothFound()
    }
  });
  admin.database().ref('/users').orderByChild('phone').equalTo(to).once("value", function(snapshot) {
  	//found object is here just to pass it to function isBadPhone by reference
    var found = { id : to };
    if (!isBadPhone(snapshot, found)) {
      to = found.id
      sendResIfBothFound()
    }
  });
});










app.get('/getOwes', (req, res) => {
  console.log('getOwes');


  // uid from provided auth token
  var who = req.user.uid;
  var status = req.query.status;

  admin.database().ref(`/users/${who}/owes/${status}`).once("value", function(snapshot) {
    const val = snapshot.val();

    if (val == null) {
      res.send([]);
    } else {
      var arr = Object.keys(val);
      var resArr = [];

      var owesToGet = arr.length;

      var sendResFormatted = function() {
        --owesToGet;
        if (owesToGet == 0) {
          if (!res.headerSent) {
            res.status(200).send(resArr);
          }
        }
      }

      arr.forEach(function(id) {
        admin.database().ref(`/owes/${id}/`).once("value", function(snapshot2) {
          const val2 = snapshot2.val();

          if (val2 == null) {
            if (ignoreNotFoundOweIds) {
              sendResFormatted()
            } else {
              if (!res.headerSent) {
                res.status(oweNotFoundCode).send({
                  error : { 
                    code : oweNotFoundCode,
                    message : `Owe with the id '${id}' not found.`,
                    oweId : id
                  }
                });
              }
            }
          } else {
            var who = val2.who;
            var to = val2.to;

            var userNotFound = function(invalidId) {

              if (ignoreNotFoundUserIds) {
                sendResFormatted();
              } else {
                if (!res.headerSent) {
                  res.status(userIdNotFoundCode).send({
                    error : { 
                      code : userIdNotFoundCode,
                      message : `User with the id '${invalidId}' in the specified OWE not found.`,
                      userId : invalidId,
                      owe : val2
                    }
                  });
                }
              }
            }

            var counter = 0;
            var setOweIfBothFound = function() {
              ++counter;

              if(counter == 2) {
                val2.id = id;
                val2.who = who;
                val2.to = to;
                resArr.push(val2);
                sendResFormatted();
              }
            }

            //get phone numbers, replace ids with it, set result to arr
            admin.database().ref(`/users/${who}/`).once("value", function(snapshot3) {
              const val3 = snapshot3.val();

              if (val3 == null) {
                userNotFound(who)
              } else {
                who = val3.phone;
                setOweIfBothFound();
              }
            });

            admin.database().ref(`/users/${to}/`).once("value", function(snapshot3) {
              const val3 = snapshot3.val();

              if (val3 == null) {
                userNotFound(to)
              } else {
                to = val3.phone;
                setOweIfBothFound();
              }
            });
          }
        });
      });
    }
  });
});









app.get('/setPhone', (req, res) => {
  console.log('setPhone');
  // uid
  const who = req.user.uid;
  const phone = phoneNumberToDigits(req.query.phone);

  if (phone == null || phone == "") {
    res.status(400).send({
        error : { 
          code : 400,
          message : `Can't set empty phone number.`
        }
      });
    return;
  }

  //set phone to my id if nobody has already claimed it
  admin.database().ref('/users').orderByChild('phone').equalTo(phone).once("value", function(snapshot) {
    var val = snapshot.val();
    //if nobody claimed or already mine
    if (val == null || Object.keys(val)[0] == who) {
      admin.database().ref(`/users/${who}/phone/`).set(phone);
      res.status(200).send({
        result: `Successfully set phone '${phone}'.`, 
        phone: phone
      });
    } else {
      const phoneNumberIsAlreadyClaimed = 403;
      res.status(phoneNumberIsAlreadyClaimed).send({
        error : { 
          code : phoneNumberIsAlreadyClaimed,
          message : `Somebody else has already claimed that phone number.`,
          phone : phone
        }
      });
    }
  });
});









app.get('/changeOwe', (req, res) => {
  console.log('changeOwe');

  const id = req.query.id;
  const action = req.query.action;

  if (id == null) {
    res.status(400).send({
      error : { 
          code : 400,
          message : `Provide the id parameter to delete an owe.`
        }
    })
  }

  admin.database().ref(`/owes/${id}/`).once("value", function(snapshot) {
    const val = snapshot.val();

    if (val == null) {
      if (ignoreNotFoundOweIds) {
        res.status(200).send({})
      } else {
        if (!res.headerSent) {
          res.status(oweNotFoundCode).send({
            error : { 
              code : oweNotFoundCode,
              message : `Owe with the id '${id}' not found.`,
              oweId : id
            }
          });
        }
      }
    } else {
      val.id = id;
      // uid
      var who = val.who
      // uid
      var to = val.to;

      if (to !== req.user.uid && who !== req.user.uid) {
        res.status(403).send({
          error : { 
              code : 403,
              message : `You have to be a participant in an owe you want to modify.'`,
              oweId : id
            }
        })
      } else {
	    var statusOld = val.status;

      if((action == "cancel" && who == req.user.uid)) {
          changeOweStatusUnsafe(val, OWE_STATUS_CANCELLED)
      }

	    if ((action == "close" && to == req.user.uid) || (action == "confirm" && who == req.user.uid)) {
	    	  var status = action == "close" ? OWE_STATUS_CLOSED : OWE_STATUS_ACTIVE

	        changeOweStatusUnsafe(val, status)
	    }

        res.status(200).send({})
      }
    }
  });
});









// This HTTPS endpoint can only be accessed by your Firebase Users.
// Requests need to be authorized by providing an `Authorization` HTTP header
// with value `Bearer <Firebase ID Token>`.
exports.app = functions.https.onRequest(app);


/*

req.user :

{ iss: 'https://securetoken.google.com/owe-ios',
  name: 'nonickname noname',
  picture: 'https://lh3.googleusercontent.com/-a7cMw8ykgbo/AAAAAAAAAAI/AAAAAAAAAAA/APJypA3vAtazI3D2jIlzztNF8jPCMf4Uhw/s96-c/photo.jpg',
  aud: 'owe-ios',
  auth_time: 1504484229,
  user_id: 's0R4vscT1WZ5XKlg9SIMpldgM102',
  sub: 's0R4vscT1WZ5XKlg9SIMpldgM102',
  iat: 1504584833,
  exp: 1504588433,
  email: 'slavyan6363@gmail.com',
  email_verified: true,
  firebase: 
   { identities: { 'google.com': [Object], email: [Object] },
     sign_in_provider: 'google.com' },
  uid: 's0R4vscT1WZ5XKlg9SIMpldgM102' }





*/