"use strict";


const oweNotFoundCode = 500;
const ignoreNotFoundOweIds = true;

const userIdNotFoundCode = 500;
const ignoreNotFoundUserIds = true;

const phoneNotFoundErrorCode = 400;
const phoneNumberIsAlreadyClaimed = 403;

const OWE_STATUS_REQUESTED = 'requested'
const OWE_STATUS_ACTIVE = 'active'
const OWE_STATUS_CLOSED = 'closed'
const OWE_STATUS_CANCELLED = 'cancelled'
const OWE_STATUS_REQUESTED_CLOSE = 'requested_close'

//Create ACTIVE owes without confirmation of debtor
const DEBUG_CREATE_ONLY_ACTIVE_OWES = false;






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






//var completion = function(oweObject, error) { }
//oweObject = {} in case of an error
//error = null - json object, ready to send as response
//
//use requesterUid "ANY" to pass security check
var getOweObjectWithUsersUids = function(id, requesterUid, completion) {
  admin.database().ref(`/owes/${id}/`).once("value", function(snapshot) {
    const owe = snapshot.val();

    if (owe == null) {
      if (ignoreNotFoundOweIds) {
        completion({}, null);
      } else {
        completion({}, {
          error : { 
            code : oweNotFoundCode,
            message : `Owe with the id '${id}' not found.`,
            id : id
          }
        });
      }
    } else {
      if (owe.to != requesterUid && owe.who != requesterUid && requesterUid != "ANY") {
        completion({}, {
          error : { 
              code : 403,
              message : `You have to be a participant in an owe you want to modify.'`,
              id : id
            }
        })
      } else {
        owe.id = id;
        completion(owe, null);
      }
    }
  });


}

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

var checkForOwePairs = function(who, to) {
  var counter = 0;
  var owesWho = [];
  var owesTo = [];

  getOwesOfUser(who, OWE_STATUS_ACTIVE, function(owesArray, error) { 
    if(error != null) {
      res.status(error.error.code).send(error);
    } else {
      var arr1 = [];
      var arr2 = [];
      var firstUid = null;
    
      owesArray.forEach(function(owe) {
        if (firstUid == null) {
          firstUid = owe.who;
        }

        if (owe.who == firstUid) {
          arr1.push(owe);
        } else {
          arr2.push(owe);
        }
      });

      console.log("FOUND OWE PAIRS");
      console.log(arr1);
      console.log(arr2);
      console.log("///FOUND OWE PAIRS");

      while (arr1.length > 0 && arr2.length > 0) {
        var o1 = arr1[0];
        var o2 = arr2[0];
        arr1.splice(0, 1);
        arr2.splice(0, 1);

        changeOweStatusUnsafe(o1, OWE_STATUS_CLOSED);
        changeOweStatusUnsafe(o2, OWE_STATUS_CLOSED);

        var newSum = null;
        var maxOwe = null;

        o1.sum = parseInt(o1.sum);
        o2.sum = parseInt(o2.sum);

        if (o1.sum == o2.sum) {
          //do nothing
        } else if (o1.sum > o2.sum) {
          newSum = o1.sum - o2.sum;
          maxOwe = o1;
          console.log(`${o1.sum} - ${o2.sum} = ${newSum}`);
        } else {
          newSum = o2.sum - o1.sum;
          maxOwe = o2;
          console.log(`${o2.sum} - ${o1.sum} = ${newSum}`);
        }

        if (o1.sum != o2.sum) {
          var newOwe = {
            who: maxOwe.who, 
            to: maxOwe.to, 
            sum: `${newSum}`, 
            descr: "Accumulated",
            status: OWE_STATUS_ACTIVE,
            created: Date.now(),
            closed: 0
          };

          newOwe.id = createOwe(newOwe);

          if (newOwe.who == firstUid) {
            arr1.push(newOwe);
          } else {
            arr2.push(newOwe);
          }
        }
      }
    }
  }, to);
}

//var completion = function(owesArray, error) { }
//owesArray = [] in case of an error
//error = null - json object, ready to send as response
var getOwesOfUser = function(who, status, completion, onlyIncludingUid) {
  admin.database().ref(`/users/${who}/owes/${status}`).once("value", function(snapshot) {
    const oweIdsList = snapshot.val();

    if (oweIdsList == null) {
      completion([], null)
    } else {
      var idsArray = Object.keys(oweIdsList);
      var owesToGet = idsArray.length;
      var resArr = [];

      var onOweAdded = function() {
        --owesToGet;
        if (owesToGet == 0) {
          completion(resArr, null);
        }
      }

      idsArray.forEach(function(id) {
        admin.database().ref(`/owes/${id}/`).once("value", function(snapshot2) {
          const owe = snapshot2.val();

          if (owe == null) {
            if (ignoreNotFoundOweIds) {
              onOweAdded()
            } else {
              completion([], {
                error : { 
                  code : oweNotFoundCode,
                  message : `Owe with the id '${id}' not found.`,
                  oweId : id
                }
              });
            }
          } else {
            owe.id = id;

            if (typeof onlyIncludingUid != 'undefined') { 
              if (owe.who == onlyIncludingUid || owe.to == onlyIncludingUid) {
                resArr.push(owe);
              }
            } else {
              resArr.push(owe);
            }

            onOweAdded();
          }
        });
      });
    }
  });
}

//var completion = function(owesWithPhones, error) { }
//owesArray = [] in case of an error
//error = null - json object, ready to send as response
var replaceUidsWithPhonesInOwesArray = function(owes, completion) {
  var resultArray = []
  var counter = owes.length * 2;

  var onReplace = function() {
    --counter;
    if(counter == 0) {
      completion(owes, null);
    }
  }

  owes.forEach(function(owe) {
    getPhoneForUid(owe.who, function(phone) { owe.who = phone; onReplace(); });
    getPhoneForUid(owe.to, function(phone) { owe.to = phone; onReplace(); });
  });
}

//var completion = function(phone) { }
//phone will be "undefinedPhone" if phone was not found
var getPhoneForUid = function(who, completion) {
  admin.database().ref(`/users/${who}/`).once("value", function(snapshot) {
    const user = snapshot.val();

    if (user == null || user.phone == null) {
      //userNotFound(who)
      completion("undefinedPhone");
    } else {
      completion(user.phone);
    }
  });
}

/*var userNotFound = function(invalidId) {
  if (ignoreNotFoundUserIds) {
    onOweAdded();
  } else {
    completion([], {
      error : { 
        code : userIdNotFoundCode,
        message : `User with the id '${invalidId}' in the specified OWE not found.`,
        userId : invalidId,
        owe : owe
      }
    });
  }
}*/

/*
oweObject:
{
  who: who, 
  to: to, 
  sum: sum, 
  descr: descr,
  status: status,
  created: Date.now(),
  closed: 0
}
*/
var createOwe = function(oweObject) {
  //push new OWE object and get it's db key
  var oweKey = admin.database().ref(`/owes`).push(oweObject).key;

  //add oweKey to users who should know about this OWE
  admin.database().ref(`/users/${oweObject.who}/owes/${oweObject.status}/${oweKey}`).set(true)
  admin.database().ref(`/users/${oweObject.to}/owes/${oweObject.status}/${oweKey}`).set(true)

  return oweKey;
}

//var completion = function(owner, error) { }
//phone is string or null (if error is not null)
//error is either null (success) or is { error : { code:int, message:string } }
var getPhoneOwner = function(phone, completion) {
  admin.database().ref(`/phoneOwners/${phone}`).once("value", function(snapshot) {
    var phoneContainer = snapshot.val();
    if (phoneContainer == null || phoneContainer.user == null) {
      completion(null, {
        error : {
          code : phoneNotFoundErrorCode,
          message : "Phone not found"
        }
      });
    } else {
      completion(phoneContainer.user, null);
    }
  });
}

//var completion = function(error) { }
//error is either null (success) or is { error : { code:int, message:string } }
var setPhoneOwner = function(phone, newOwner, completion) {
  getPhoneOwner(phone, function(owner, error) {
    if(owner == null || owner == newOwner) {
      getPhoneForUid(newOwner, function(oldPhone) {
        if (oldPhone == "undefinedPhone") {

        } else {
          //declaim old phone
          admin.database().ref(`/phoneOwners/${oldPhone}`).remove();
        }

        //claim new
        admin.database().ref(`/phoneOwners/${phone}/user`).set(newOwner);
        admin.database().ref(`/users/${newOwner}/phone`).set(phone);
        completion(null);
      });
    } else {
      completion({
        error : { 
          code : phoneNumberIsAlreadyClaimed,
          message : `Somebody else has already claimed that phone number.`,
          phone : phone
        }
      });
    }
  });
}

/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////




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
  var onUidFound = function() {
    ++counter;
    if(counter == 2) {
      // we are not allowing to create an OWE between two users if no one of them is you
      if (who != req.user.uid && to != req.user.uid) {
        console.log(req.user.uid + " req for " + who + " " + to)
        res.sendStatus(403);
        return;
      }

      //if requster is the debtor then we don't need any confirmations by the creditor
      var status = who == req.user.uid ? OWE_STATUS_ACTIVE : OWE_STATUS_REQUESTED;
      if (DEBUG_CREATE_ONLY_ACTIVE_OWES) {
        status = OWE_STATUS_ACTIVE;
      }

      var oweKey = createOwe({
        who: who, 
        to: to, 
        sum: sum, 
        descr: descr,
        status: status,
        created: Date.now(),
        closed: 0
      });

      //return new OWE key with status SUCCESS
      res.status(200).send({ 
        result: 'Successfully added new OWE object, see \'oweId\' field for it\'s id.', 
        oweId: oweKey 
      });

      if (status == OWE_STATUS_ACTIVE) {
        checkForOwePairs(who, to);
      }
    }
  }

  var sendError = function(error) {
    if (error != null) {
      if (!res.headerSent) {
        res.status(error.error.code).send(error);
      }
      return true;
    }
    return false;
  }

  getPhoneOwner(who, function(owner, error){
    if (!sendError(error)) {
      who = owner;
    }
    onUidFound();
  });

  getPhoneOwner(to, function(owner, error){
    if (!sendError(error)) {
      to = owner;
    }
    onUidFound();
  });
});










app.get('/getOwes', (req, res) => {
  console.log('getOwes');


  // uid from provided auth token
  var who = req.user.uid;
  var status = req.query.status;

  getOwesOfUser(who, status, function(owesArray, error) { 
    if (error != null) {
      res.status(error.error.code).send(error);
    } else {
      replaceUidsWithPhonesInOwesArray(owesArray, function(owesWithPhones, error){
        res.status(200).send(owesWithPhones);
      });
    }
  })
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

  setPhoneOwner(phone, who, function(error){
    if (error == null) {
      res.status(200).send({
          result: `Successfully set your phone to '${phone}'.`, 
          phone: phone
      });
    } else {
      res.status(error.error.code).send(error);
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

  getOweObjectWithUsersUids(id, req.user.uid, function(oweObject, error){
    if (error != null) {
      console.log(`ERROR /changeOwe ${error}`);
      res.status(error.error.code).send(error);
    } else {
      console.log("Change owe OK");
      var statusOld = oweObject.status;

      if((action == "cancel" && oweObject.who == req.user.uid)) {
          changeOweStatusUnsafe(oweObject, OWE_STATUS_CANCELLED)
      }

      if ((action == "close" && oweObject.to == req.user.uid) || (action == "confirm" && oweObject.who == req.user.uid)) {
          var status = action == "close" ? OWE_STATUS_CLOSED : OWE_STATUS_ACTIVE
          changeOweStatusUnsafe(oweObject, status)
      }

      res.status(200).send({})
    }
  })

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