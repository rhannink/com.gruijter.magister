"use strict";

Homey.log("entering driver.js");

var Magister = require('magister.js');
var devices = {};
var intervalId1 = {};   //polling of device for course info
var intervalId2 = {};   //polling of device for grades
var intervalId3 = {};   //polling of device for day roster

module.exports.init = function(devices_data, callback) {
    Homey.log("init in driver.js started");
    devices_data.forEach(initDevice);
    callback(null, true);
};

module.exports.pair = function(socket) {
  // Validate Magister connection data
  socket.on('validate', function (credentials, callback){
    validateConnection(credentials, function(error, student) {
      if (!error) {
        Homey.log('Pairing successful');
        callback(null, student);
      }
      if (error) {
        Homey.log('Pairing unsuccessful');
        callback( error, null );
      }
    });
  });
};

// the `added` method is called is when pairing is done and a device has been added for firmware 8.33+
module.exports.added = function( device_data, callback ) {
  Homey.log("initializing device ");
  Homey.log(device_data);
  initDevice( device_data );
  callback( null, true );
}


module.exports.deleted = function(device_data, callback) {
  Homey.log('Deleting ' + device_data.id);
  clearInterval(intervalId1[device_data.id]); //end polling of device for course info
  clearInterval(intervalId2[device_data.id]); //end polling of device for grades
  clearInterval(intervalId3[device_data.id]); //end polling of device for day roster
  setTimeout(function() {         //wait to let current poll finish
    delete devices[device_data.id];
  },30000)
  callback(null, true);
};

module.exports.renamed = function( device_data, new_name ) {
  Homey.log(devices[device_data.id].name + ' has been renamed to ' + new_name);
  devices[device_data.id].name = new_name;
//  Homey.log(devices[device_data.id].name);
};

module.exports.settings = function(device_data, newSettingsObj, oldSettingsObj, changedKeysArr, callback) {
	// run when the user has changed the device's settings in Homey.
	// changedKeysArr contains an array of keys that have been changed, for your convenience :)
  Homey.log(device_data);
  Homey.log('old settings: ');
  Homey.log(oldSettingsObj);
  Homey.log('new settings: ')
  Homey.log(newSettingsObj);

//  changedKeysArr.forEach(function(item){
//    Homey.log(item + " old: "+oldSettingsObj[item]);
//    Homey.log(item + " new: "+newSettingsObj[item]);
//  });

  validateConnection(newSettingsObj, function(error, result) {
    if (error) {
      Homey.log('Connection is invalid, ignoring new settings');
      callback( error, null ); //  settings must not be saved
      return
    };
    if (result.id!=device_data.magisterId) {
      Homey.log("Not the student that was paired with");
      callback( "This is a different student", null ); //  settings must not be saved
      return
    };
    if (!error) {
      Homey.log('Storing new device settings');
      callback(null, true); 	// always fire the callback, or the settings won't change!
      //update the settings with received data from Magister
      var settings = {
        student		: result,
        school		: result.magisterSchool.name,
        studentName	: result.fullName
      }
      module.exports.setSettings( device_data, settings, function( err, settings ){
            // ... dunno what to do here, think nothing...
      });
    }
  });
};

function validateConnection(credentials, callback) {  // Validate Magister connection data
  Homey.log('Validating', credentials);
  getPupil(credentials, function (error, student){
    if (error) {
      Homey.log("Error connecting: ", error);
      callback(error, null);
      return;
    }
    else {
      Homey.log(student);
      Homey.log('Connecting successful!');
      callback(null, student);
      return;
    }
  });
};   // end validate routine


//====================INIT AFTER PAIRING OR AFTER REBOOT========================

function initDevice(device_data) {      //initDevice: retrieve device settings, buildDevice and start polling it
  Homey.log("entering initDevice");
  module.exports.getSettings( device_data, function( error, settings ){
    if (error) {
      Homey.log("error retrieving device settings");
    } else {
      Homey.log("retrieved settings are:");
      Homey.log(settings);
      module.exports.getName( device_data, function( error, name ){   //retrieve device name
        if (error) {
          Homey.log("error retrieving device name");
        } else {                                  // after settings and name received, build the new device object
          Homey.log("retrieved name is:");
          Homey.log(name);
          buildDevice(device_data, settings, name);
          startPolling(device_data);
        }
      });
    }
  });
} //end of initDevice


function buildDevice (device_data, settings, name){

//test with dates
  //var today = new Date();
  //var tomorrow = new Date(today);
  //tomorrow.setDate(today.getDate()+1);
  //var oneWeekAgo = new Date(today);
  //oneWeekAgo.setDate(today.getDate()-16);

  devices[device_data.id] = {
    id                : device_data.id,           //deviceID created during pairing
    homey_device      : device_data,              //device_data object from moment of pairing
    student           : settings.student,         //student information in Homey created during pairing
    name              : name,                     //device name in Homey
    credentials: {
      school  : settings.school,
      username: settings.username,
      password: settings.password
      },
    currentCourse         : {},                           //schoolyear course information
    grades                : [],                           //grades in this schoolyear
    totalAverageGrade     : settings.totalAverageGrade,   //average of all grades in this schoolyear
    lastGradeDateFilledIn : new Date(),                   //start logging new grades from time of init
    dayRosterToday        : {},                           //lessons roster of this day
    dayRosterTomorrow     : {},                           //lessons roster of tomorrow
    notifyGradeChange     : settings.notifyGradeChange,   //true or false
    notifyRosterChange    : settings.notifyRosterChange   //true or false
  };
  Homey.log("init buildDevice is: " );
  Homey.log(devices[device_data.id] );
};


function startPolling(device_data){
  Homey.log("starting to poll");

  setTimeout(function() {         //delay http call to spread Homey load
    handleCourseData(device_data);     //get schoolyear courseInfo first time
    intervalId1[device_data.id] = setInterval(function () {      //start polling schoolyear courseInfo every 24 hrs
    handleCourseData(device_data)
    }, 1000*60*60*24);
  }, 5000);

  setTimeout(function() {         //delay http call to spread Homey load
    handleGradesData(device_data);      //get grades info first time
    intervalId2[device_data.id] = setInterval(function () {      //start polling grades info every 10 min
    handleGradesData(device_data)       //start polling grades info every 60 min
  }, 1000*60*60);
}, 15000);

  //testen met data
  var longAgo = new Date();
  longAgo.setDate(longAgo.getDate()-0);
  var today = new Date(longAgo);
  var tomorrow = new Date(longAgo);
  tomorrow.setDate(today.getDate()+1);

  setTimeout(function() {                             //delay http call to spread Homey load
    handleDayRosterToday(device_data, today);         //get dayRosterToday info first time
    setTimeout(function() {                           //delay http call to spread Homey load
      handleDayRosterTomorrow(device_data, tomorrow)  //get dayRosterTomorrow info first time
    }, 10000);
    intervalId3[device_data.id] = setInterval(function () {      //start polling dayRoster info every 10 min
      longAgo = new Date();
      longAgo.setDate(longAgo.getDate()-0);
      today = new Date(longAgo);
      tomorrow = new Date(today);
      tomorrow.setDate(today.getDate()+1);
      handleDayRosterToday(device_data, today);
      setTimeout(function() {         //delay http call to spread Homey load
        handleDayRosterTomorrow(device_data, tomorrow)
      }, 20000);
    }, 1000*60*10);
  }, 25000);

}  //end startPolling


//=======================HANDLE THE RETRIEVED POLLING DATA======================

function handleCourseData(device_data){
  getCourse(devices[device_data.id].credentials, function (error, result){
    if (result!=null) {
      if ( JSON.stringify(result)!=JSON.stringify(devices[device_data.id].currentCourse) ) {
        Homey.log("course has changed");
        //Homey.log(result);
        //Homey.manager('speech-output').say( "Er is iets veranderd in Magister: het schooljaar" );
        devices[device_data.id].currentCourse=result;
        var settings = {
          period: result.period,
          type_group: result.type.description + " " + result.group.description
        };
        module.exports.setSettings( device_data, settings, function( err, settings ){
              // ... dunno what to do here, think nothing...
        });
      }
    }
  });
};

function handleGradesData(device_data){
  getGrades(devices[device_data.id].credentials, function (error, result){
    if (result!=null) {
      for (var index in result) {
        if (result[index].dateFilledIn > devices[device_data.id].lastGradeDateFilledIn) {
          Homey.log(devices[device_data.id].name + " has a new grade for: " +
            devices[device_data.id].currentCourse.classesById[result[index].class.id].description
          );
//          Homey.log(result[index]);

          // say the new grade if selected in settings.
          if(devices[device_data.id].notifyGradeChange){
            var temp_device_data = new Object(devices[device_data.id]);
            var args = {
              when: "last",
              device_data: temp_device_data
            }
            args.device_data.grades.push(result[index]);
            sayGrades(args);
          };

          logGrade(device_data, result[index]);

        // Trigger flow for new grade
          Homey.manager('flow').triggerDevice('new_grade', {
            name        : devices[device_data.id].name,
            class       : devices[device_data.id].currentCourse.classesById[result[index].class.id].description,
            description : result[index].description,
            grade       : result[index].grade,
            weight      : result[index].weight
            },
            null,
            devices[device_data.id].homey_device
          );
        }
      };
      var datesFilledIn = ( result.map(function (g) {       //get an array of all dateFilledIn
          return Date.parse(g.dateFilledIn);
        })
      );
      devices[device_data.id].lastGradeDateFilledIn = new Date (datesFilledIn.sort().pop());  //store last dateFilledIn
      devices[device_data.id].grades=result;                                                  //store all retrieved grades
      devices[device_data.id].totalAverageGrade=calcAverageGrade(device_data);                //calculate and store total average grade
      var settings = {
        totalAverageGrade: devices[device_data.id].totalAverageGrade.toFixed(2)
      };
      module.exports.setSettings( device_data, settings, function( err, settings ){
            // ... dunno what to do here, think nothing...
      });
      //Homey.log(result)
      //Homey.log(devices[device_data.id]);
    }
  });

};


function logGrade(device_data, grade){
  var logDate = Date.parse(grade.dateFilledIn); // use dateFilledIn as logdate
  if (grade.testDate != undefined) { logDate = Date.parse(grade.testDate) };  //// use testDate as logdate
  logDate = new Date(logDate);       // e.g. Tue Sep 23 2015 00:00:00 GMT+0200 (CEST)
  //Homey.log(logDate);

  //create new log for grade in Homey
  //Homey.log(grade.class);
  Homey.manager('insights').createLog( grade.class.id.toString(), {
      label: {
          en: devices[device_data.id].currentCourse.classesById[grade.class.id].description
      },
      type: 'number',
      chart: 'stepLine' // prefered, or default chart type. can be: line, area, stepLine, column, spline, splineArea, scatter
  }, function callback(err , success){
      //if( err ) Homey.log(Homey.error(err)); //return Homey.error(err);
      Homey.manager('insights').createEntry( grade.class.id.toString(), parseFloat(grade.grade), logDate, function(err, success){
          if( err ) {
            Homey.log(Homey.error(err)); //return Homey.error(err);
          };
      });
  });
};

function calcAverageGrade (device_data) {
  var totalAverage=0;
  var totalWeight=0;
  var totalWeightedGrade=0;
  devices[device_data.id].grades.forEach(function(currentGrade,index,arr){
    if( !isNaN(currentGrade.grade*currentGrade.weight) && currentGrade.grade>=0 ) {
      totalWeightedGrade=totalWeightedGrade+currentGrade.grade*currentGrade.weight;
      totalWeight=totalWeight+currentGrade.weight;
    }
  });
  if (totalWeight!=0){
    totalAverage=totalWeightedGrade/totalWeight;
  }
  Homey.log("Total Average Grade is: "+totalAverage);
  return totalAverage;
}


function handleDayRosterToday(device_data, date){
  getDayRoster(devices[device_data.id].credentials, date, function (error, result){
    if (!error) {
      //Homey.log(JSON.stringify(result));
      if ( JSON.stringify(result)!=JSON.stringify(devices[device_data.id].dayRosterToday) ) {
        Homey.log("dayroster today has changed");
        // Trigger flow for roster_changed
        Homey.manager('flow').triggerDevice('roster_changed', {
          name        : devices[device_data.id].name,
          beginHour   : result.beginHour,
          beginTime   : result.beginTime.toTimeString().substr(0, 5),
          endHour     : result.endHour,
          endTime     : result.endTime.toTimeString().substr(0, 5)
          },
          null,
          devices[device_data.id].homey_device
        );
        devices[device_data.id].dayRosterToday=result;
        // say the new roster if selected in settings.
       if(devices[device_data.id].notifyRosterChange){
          var args = {
            when: "today",
            device_data: devices[device_data.id]
          }
          sayRoster(args);
        };
      };
    };
  });
};

function handleDayRosterTomorrow(device_data, date){
  getDayRoster(devices[device_data.id].credentials, date, function (error, result){
    if (!error) {
      if (JSON.stringify(result)!=JSON.stringify(devices[device_data.id].dayRosterTomorrow) ) {
        Homey.log("dayroster tomorrow has changed");
        devices[device_data.id].dayRosterTomorrow=result;
        // say the new roster if selected in settings.
        if(devices[device_data.id].notifyRosterChange){
          var args = {
            when: "tomorrow",
            device_data: devices[device_data.id]
          }
          sayRoster(args);
        };
      };
    };
  });
};




//========================GET DATA FROM MAGISTER================================

//get school and student info, used during pairing and settings update
function getPupil(credentials, callback) {
  //Homey.log("entering get pupil");
  if (credentials.school=='' || credentials.username=='' || credentials.password ==''){
    Homey.log("Error: school, username and password are required");
    callback("Error: school, username and password are required",null)
    return;
  }
  new Magister.Magister(credentials).ready(function (error) {
    if (error) {
      Homey.log("Error connecting: ", error.message);
      callback(error.message, null);
      return
    }
    else {
      Homey.log(this);
      var test;
      if( this.profileInfo().birthDate() != undefined){
        var student = {
          id: this.profileInfo().id(),
          firstName: this.profileInfo().firstName(),
          namePrefix: this.profileInfo().namePrefix(),
          lastName: this.profileInfo().lastName(),
          fullName: this.profileInfo().fullName(),
          magisterSchool: this.magisterSchool
        };
        callback(null, student);
        return;
      }
      else {
        Homey.log("Error connecting: login cannot be from a parent");
        callback("login must be from a student (not a parent)", null);
        return
      }
    }
  });
}

//schoolyear course
function getCourse(credentials, callback) {
  Homey.log("getting course info");
  new Magister.Magister(credentials).ready(function (error) {
    if (error) {
      Homey.log("Error getting course: "+ error.message);
      callback(error.message, null);
      return;
    }
    else {
      this.currentCourse(function (error, result) {
        if (error) {
          //Homey.log("got error: "+error);
          callback(error.message, null);
        }
        else {
          var courseInfo = {
            period: result.schoolPeriod(), //e.g. 1516
            begin: result.begin(),  //e.g. Sat Aug 01 2015 00:00:00 GMT+0200 (West-Europa (zomertijd))
            end: result.end(),    //e.g. Sun Jul 31 2016 00:00:00 GMT+0200 (West-Europa (zomertijd))
            type: result.type(),   // e.g. { id: 1346, description: '1 gymnasium' },
            group: result.group(),   // e.g. { id: 6150, description: '1gb', locationId: 0 },
            classesById: {}
          };

          result.classes(function(error, courseClasses) {
            if (error) {
              Homey.log(error.message);
              callback(error.message, null);
              return;
            } else {
            	for (var courseClass of courseClasses) {
            		courseInfo.classesById[courseClass.id()] = {
                  id: courseClass.id(),                       //e.g. 532518
                  abbreviation: courseClass.abbreviation(),   //e.g. 'ne'
                  description: courseClass.description(),     //e.g. 'Nederlandse taal'
                  number: courseClass.number()                //e.g. 1
                };
            	};
              //Homey.log(courseInfo);
              callback(null, courseInfo);
            };
          });
        };
    	});
    }
  });
}


//grades
function getGrades(credentials, callback) {
  Homey.log("getting grades info");
  var grade = {};
  var grades = [];

  new Magister.Magister(credentials).ready(function (error) {
    if (error) {
      Homey.log("Error getting grades: "+error.message);
      callback(error.message, null);
      return;
    }
    else {
    	this.currentCourse(function (error, result) {
        if (error) {
          Homey.log("Error getting currentCourse: "+error);
          callback (error.message, null);
          return;
        }
        else {
          //console.log(result);
        	result.grades(function (error, result) {
            //console.log(result);
            for(var index in result) {
              //console.log(result[index]);
              grade = {
                id: result[index].type().id(),   //e.g. 284587
                class: result[index].class(),   //e.g. { id: 532518, abbreviation: 'ne', description: '' }
                period: result[index].gradePeriod(),  //e.g. { id: 3117, name: 'T2' }
                testDate: result[index].testDate(), //e.g. Tue Nov 17 2015 00:00:00 GMT+0100 (CET)
                dateFilledIn: result[index].dateFilledIn(),  //e.g. Tue Mar 29 2016 11:26:10 GMT+0200 (West-Europa (zomertijd))
                description: result[index].description(), //e.g. SO Spelling H1-4
                grade: result[index].grade().replace(',', '.'),  //e.g. 7.2
                weight: result[index].weight()  //e.g. 2
              };
              grades.push(grade);
            }
            //console.log(grades);
            callback (null, grades);
      		});
        };
    	});
    }
  });
}


function getDayRoster(credentials, date, callback) {
  Homey.log("getting roster info for: "+ date);
  var dayRoster = {};
  var lesson = [];

  new Magister.Magister(credentials).ready(function (error) {
    if (error) {
      Homey.log("Error getting day roster: "+ error);
      callback(error, null);
      return;
    }
    else {
    	this.appointments(date, function (error, result) {
        //Homey.log(result[0]);
        dayRoster = {
          beginHour   : null,
          beginTime   : null,
          endHour     : null,
          endTime     : null,
          description : "",
          content     : "",
          fullDay     : null,
          lessons     : []
        };
        if (result[0]==undefined){
          Homey.log("No lessons for this day: "+date);
          callback (null, dayRoster);
          return;
        };

        for (var index in result) {
          if (result[index].scrapped() == false && dayRoster.beginHour == null ) {   //get first non-scrapped schoolhour
            dayRoster.beginHour = result[index].beginBySchoolHour();
            dayRoster.beginTime = result[index].begin();
            dayRoster.description = result[index].description();
            dayRoster.content = result[index].content();
            dayRoster.fullDay = result[index].fullDay()
          };
          if (result[index].scrapped() == false) {   //get last non-scrapped schoolhour
            dayRoster.endHour = result[index].beginBySchoolHour();
            dayRoster.endTime = result[index].end();
          }
        };

        if ( result[0].beginBySchoolHour() == null ) {
          Homey.log("No lessons for this day: "+date);
          callback (null, dayRoster);
          return;
        } else {
          for(var index in result) {
            //console.log(result[index]);
            lesson = {
              hour: result[index].beginBySchoolHour(), //e.g. 1
              begin: result[index].begin(),   //e.g. Thu Jun 23 2016 08:00:00 GMT+0200 (West-Europa (zomertijd))
              end: result[index].end(),       //e.g. Thu Jun 23 2016 14:00:00 GMT+0200 (West-Europa (zomertijd))
              description: result[index].description(), // e.g. 'te - pri - 1gb' or 'Toetsweek'
              content: result[index].content(),   //e.g. null or 'Maken\tblz 164: opgave 27 t/m 31' or 'Toetsweek, rooster op www.minkema.nl'
              class: result[index].classes()[0], //e.g. 'tekenen',
              fullDay: result[index].fullDay(), // e.g. false
              location: result[index].location(), //e.g. 'M218',
              teacher: result[index].teachers()[0].fullName(), //e.g. 'G. D. Lasseur'
              scrapped: result[index].scrapped(),  //e.g. true
              changed: result[index].changed(),   //e.g. false
              absenceInfo: result[index].absenceInfo()  //e.g. undefined
            };
            //console.log(lesson);
            dayRoster.lessons.push(lesson);
          }
        }
        //Homey.log(dayRoster);
        callback(null, dayRoster);
        return;
    	});
    };
  });
}



//============================ACTION FLOWS=====================================

Homey.manager('flow').on('action.sayRoster', function( callback, args ){
  sayRoster(args);
  callback( null, true ); // we've fired successfully
});

Homey.manager('flow').on('action.sayHomework', function( callback, args ){
  sayHomework(args);
  callback( null, true ); // we've fired successfully
});

Homey.manager('flow').on('action.sayGrades', function( callback, args ){
  sayGrades(args);
  callback( null, true ); // we've fired successfully
});

//========================SPEECH OUTPUT=========================================

function sayRoster (args) {
  if (args.when == "today"){
    var requested_roster = devices[args.device_data.id].dayRosterToday;
    var requested_day = "vandaag";
  }
  else {
    var requested_roster = devices[args.device_data.id].dayRosterTomorrow;
    var requested_day = "morgen";
  };
  Homey.log(requested_roster);
  if (requested_roster.beginHour == null ){
    Homey.manager('speech-output').say( devices[args.device_data.id].name + " heeft geen les "+requested_day);
    if ( requested_roster.description != "" || requested_roster.content != "" ) {
      Homey.manager('speech-output').say( "er is wel een omschrijving: " +
        requested_roster.description + " " + requested_roster.content);
    }
  } else {
    Homey.manager('speech-output').say(
      "het rooster van "+ devices[args.device_data.id].name +
      " van "+ requested_day +", begint om "+ requested_roster.beginTime.toTimeString().substr(0, 5) +
      " en is afgelopen om " + requested_roster.endTime.toTimeString().substr(0, 5)
    );
    requested_roster.lessons.forEach(function(currentLesson,index,arr){
      if (currentLesson.scrapped == true){
        Homey.manager('speech-output').say("uur "+currentLesson.hour+": is uitgevallen");
      } else {
        Homey.manager('speech-output').say("uur "+currentLesson.hour+": "+currentLesson.class)
        }
    })
  }
}

function sayHomework (args) {
  if (args.when == "today"){
    var requested_roster = devices[args.device_data.id].dayRosterToday;
    var requested_day = "vandaag";
  }
  else {
    var requested_roster = devices[args.device_data.id].dayRosterTomorrow;
    var requested_day = "morgen";
  };
  Homey.log(requested_roster.lessons);
  Homey.manager('speech-output').say(
    "Huiswerk van "+ devices[args.device_data.id].name + " voor "+ requested_day
  );
  var homework = false;
  requested_roster.lessons.forEach(function(currentLesson,index,arr){
    if (currentLesson.content != ""){
      homework = true;
      Homey.manager('speech-output').say(currentLesson.class+": "+ currentLesson.content);
    }
  });
  if (homework==false){
    Homey.manager('speech-output').say(" Geen huiswerk "+requested_day);
  };
}

function sayGrades (args) {
  if (args.when == "last"){
    var lastGrade=args.device_data.grades.pop();
    Homey.manager('speech-output').say(
      devices[args.device_data.id].name + " heeft een nieuw cijfer voor "+
      devices[args.device_data.id].currentCourse.classesById[lastGrade.class.id].description +
      ", een " + lastGrade.grade + "! Deze telt " + lastGrade.weight + " keer mee"
    );
    return;
  };
  if (args.when == "today"){
    var requested_period = new Date();
    requested_period.setDate(requested_period.getDate()-1);
    var requested_day = "vandaag";
  };
  if (args.when == "week"){
    var requested_period = new Date();
    requested_period.setDate(requested_period.getDate()-7);
    var requested_day = "de afgelopen 7 dagen";
  };
  Homey.log("saying grades since " + requested_period);
  Homey.manager('speech-output').say(
    "Nieuwe cijfers van "+ devices[args.device_data.id].name + " voor "+ requested_day
  );
  var newGrades = false;
  devices[args.device_data.id].grades.forEach(function(currentGrade,index,arr){
    if (currentGrade.dateFilledIn >= requested_period){
      newGrades = true;
      Homey.manager('speech-output').say( devices[args.device_data.id].currentCourse.classesById[currentGrade.class.id].description +
        ", een " + currentGrade.grade + "! Deze telt " + currentGrade.weight + " keer mee"
      );
    }
  });
  if (newGrades==false){
    Homey.manager('speech-output').say(" Geen nieuwe cijfers "+requested_day);
  };
}
