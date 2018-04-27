/*
Copyright 2016 - 2018, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.magister.

com.gruijter.magister is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.magister is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.magister.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const Homey = require('homey');
const Logger = require('./captureLogs.js');
const mapi = require('./mapi.js');
const HomeyStudent = require('./homeyStudent.js');
const fs = require('fs');
// const util = require('util');

// ========================SPEECH OUTPUT=========================================

async function sayGrades(args) {
	try {
		let requestedPeriod;
		let requestedDay;
		if (args.when === 'today') {
			requestedPeriod = new Date();
			requestedPeriod.setDate(requestedPeriod.getDate() - 1);
			requestedDay = Homey.__('today');
		} else { // args.when === 'week'
			requestedPeriod = new Date();
			requestedPeriod.setDate(requestedPeriod.getDate() - 7);
			requestedDay = Homey.__('the past 7 days');
		}
		const student = new HomeyStudent();
		await student.loadSettings(args.student.studentId);	// get student settings from persistent storage
		await student.login();
		const grades = await student.getAllGrades();
		const selectedGrades = grades.filter(grade => new Date(grade.dateFilledIn) > new Date(requestedPeriod));
		Homey.ManagerSpeechOutput.say(`${Homey.__('new grades of')} ${student.firstName} ${Homey.__('of')} ${requestedDay}`);
		if (selectedGrades.length < 1) {
			return Homey.ManagerSpeechOutput.say(`${Homey.__('no new grades')} ${requestedDay}`);
		}
		selectedGrades.forEach((grade) => {
			Homey.ManagerSpeechOutput.say(`${grade.classDescription} ${Homey.__('its a')} ${grade.grade}
			${Homey.__('this one counts')} ${grade.weight} ${Homey.__('times')}`);
		});
	} catch (err) {	Homey.app.log(err); }
	return true;
}

class MagisterApp extends Homey.App {

	onInit() {
		this.log('Magister app is running!');
		this.logger = new Logger('log', 200);
		// register some listeners
		process.on('unhandledRejection', (error) => {
			this.error('unhandledRejection! ', error);
		});
		process.on('uncaughtException', (error) => {
			this.error('uncaughtException! ', error);
		});
		Homey
			.on('unload', () => {
				this.log('app unload called');
				// save logs to persistant storage
				this.logger.saveLogs();
				// unregister listeners
				// this.newGradeTrigger.unregister(); ?????
			})
			.on('memwarn', () => {
				this.log('memwarn!');
			});

		// init some variables
		this.autoCompleteList = [];
		this.registerFlowCards();
		this.startPolling();
	}

	startPolling() {
		try {
			this.log('Polling started');
			clearInterval(this.intervalId);	// stop polling first
			this.makeAutocompleteList();	// needed for flowcards
			this.pollStudentsOnce();	// get the first round of info right away
			this.intervalId = setInterval(() => {
				this.pollStudentsOnce();
			}, 1000 * 60 * 10);// poll every 10 min
		} catch (error) {
			this.error(error);
		}
	}

	async pollStudentsOnce() {
		const studentIds = Homey.ManagerSettings.getKeys();
		// this.log(studentIds);
		for (let idx = 0; idx < studentIds.length; idx += 1) {	// poll each student sequentially
			const studentId = studentIds[idx];
			const student = new HomeyStudent();
			await student.loadSettings(studentId);	// get student settings from persistent storage
			await student.login();
			await this.handleGradesData(student);
			// const appointments = await mapi.getAppointments(student, Date('2018-04-15'));
			// this.log(appointments);
			await student.saveSettings();	// save student changes back to persistent storage
		}
	}

	//  stuff for frontend API
	deleteLogs() {
		return this.logger.deleteLogs();
	}
	getLogs() {
		return this.logger.logArray;
	}
	saveAccount(credentials) {
		this.log('Validating and saving', credentials);
		return new Promise(async (resolve, reject) => {
			try {
				const newStudent = new HomeyStudent(credentials);
				await newStudent.login();
				newStudent.setLastLogDate(0); // get all grades from this course
				const settings = await newStudent.saveSettings();
				this.startPolling();
				return resolve(settings);
			} catch (error) {
				this.error(error);
				return reject(error);
			}
		});
	}
	deleteAccount(studentId) {
		this.log(`Deleting student: ${studentId}`);
		return new Promise((resolve, reject) => {
			try {
				this.deleteGradeLogs(Homey.ManagerSettings.get(studentId).initials);
				Homey.ManagerSettings.unset(studentId);
				fs.unlink(`./userdata/${studentId}.jpg`, (err) => {
					if (err) {
						this.error(err);	// photo delete error
					} // else { this.log('Photo deleted'); }
				});
				this.startPolling();
				return resolve('deletion is done');
			} catch (error) {
				this.error(error);
				return reject(error);
			}
		});
	}

	// other helper stuff
	makeAutocompleteList() {
		const studentIds = Homey.ManagerSettings.getKeys();
		this.autoCompleteList = [];
		studentIds.forEach((id) => {
			const student = Homey.ManagerSettings.get(id);
			const item =
				{
					image: `/app/${this.manifest.id}/userdata/${id}.jpg`,
					name: student.fullName,
					// description: student.fullName,
					studentId: id,
				};
			this.autoCompleteList.push(item);	// fill the studentList for flow autocomplete
		});
	}

	// logic to retrieve and handle student related information

	handleGradesData(student) {
		// this.log(`handling gradesData for ${student.name}`);
		return new Promise(async (resolve, reject) => {
			try {
				const newGrades = await student.getNewGrades();
				newGrades.forEach((newGrade) => {
					const label = `${student.initials}-${newGrade.classDescription}`;
					this.log(newGrade);
					this.logGrade(newGrade, label);
					const tokens = {
						name: student.firstName,
						class: newGrade.classDescription,
						description: newGrade.description,
						weight: newGrade.weight,
						grade: newGrade.grade,
					};
					const state = { studentId: student.studentId };
					this.newGradeTrigger
						.trigger(tokens, state)
						.catch(this.error);
				});
				return resolve();
			} catch (error) {
				return reject(Error(error));
			}
		});
	}

	async logGrade(grade, label) {
		try {
			const logDate = new Date(grade.testDate || grade.dateFilledIn); // use 1.testDate or 2.dateFilledIn as logdate
			const log = await Homey.ManagerInsights.getLog(grade.classId)
				.catch(async () => {
					const newLog = await Homey.ManagerInsights.createLog(grade.classId, {
						label,
						type: 'number',
						chart: 'scatter', // default chart type. can be: line, area, stepLine, column, spline, splineArea, scatter
					});
					return newLog;
				});
			log.createEntry(grade.grade, logDate);
		}	catch (error) {	this.log(error.message); }
	}

	deleteGradeLogs(studentInitials) {
		this.log(`deleting all insights for ${studentInitials}`);
		Homey.ManagerInsights.getLogs()
			.then((allLogs) => {
				const studentLogs = allLogs.filter((log) => {
					const label = log.label.en || log.label;
					return (label.toString().substring(0, 2) === studentInitials);
				});
				studentLogs.forEach(log => Homey.ManagerInsights.deleteLog(log).catch(this.error));
			})
			.catch(this.error);
	}

	handleCourseData(student) {
		// this.log(`handling courseData for ${student.profileInfo.id}`);
		return new Promise(async (resolve, reject) => {
			try {
				const currentCourse = await mapi.getCurrentCourse(student);
				const courseData = {
					type_group: `${currentCourse.type.description} - ${currentCourse.group.description}`,
					period: `${currentCourse.schoolPeriod}`,
				};
				const studentSettings = Homey.ManagerSettings.get(student.profileInfo.id);
				// this.log(studentSettings);
				if (studentSettings) {
					if ((studentSettings.type_group !== courseData.type_group) || (studentSettings.period !== courseData.period)) {
						this.log('course has changed');	// store new student settings
						studentSettings.type_group = courseData.type_group;
						studentSettings.period = courseData.period;
						Homey.ManagerSettings.set(student.profileInfo.id, studentSettings);
						this.startPolling();
					}
				}
				return resolve(currentCourse);
			} catch (error) {
				return reject(Error(error));
			}
		});
	}

	// ========================FLOWCARD STUFF=========================================

	registerFlowCards() {
		// register trigger flowcards
		this.newGradeTrigger = new Homey.FlowCardTrigger('new_grade')
			.register()
			.registerRunListener((args, state) => Promise.resolve(state.studentId === args.student.studentId));
		this.newGradeTrigger
			.getArgument('student')
			.registerAutocompleteListener((query) => {
				let results = this.autoCompleteList;
				results = results.filter(result => (result.name.toLowerCase().indexOf(query.toLowerCase()) > -1));
				return Promise.resolve(results);
			});

		// register condition flowcards

		// register action flowcards
		this.sayGradesAction = new Homey.FlowCardAction('sayGrades')
			.register()
			.registerRunListener((args) => {
				sayGrades(args);
				return Promise.resolve(true);
			});
		this.sayGradesAction
			.getArgument('student')
			.registerAutocompleteListener((query) => {
				let results = this.autoCompleteList;
				results = results.filter(result => (result.name.toLowerCase().indexOf(query.toLowerCase()) > -1));
				return Promise.resolve(results);
			});
	}


}


module.exports = MagisterApp;
