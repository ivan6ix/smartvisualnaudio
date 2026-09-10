/* global console */
import assert from 'node:assert/strict';
import { validateExam, examAvailability, toLocalDateTime } from '../src/lib/examValidation.js';
const form={title:'Exam',instructions:'',duration:'60',attempts:'1 attempt',startsAt:'2026-09-20T08:00',deadline:'2026-09-20T10:00'};
const questions=[{title:'Question',points:1,choices:[]}];
assert.equal(validateExam(form,questions),'');
for(const patch of [{title:'x'.repeat(201)},{duration:'-1'},{duration:'1.5'},{instructions:'x'.repeat(5001)},{startsAt:'invalid'},{deadline:'2026-09-19T08:00'}]) assert.ok(validateExam({...form,...patch},questions));
assert.ok(validateExam(form,[{...questions[0],points:0}]));
assert.equal(examAvailability(form,new Date('2026-09-20T07:00').getTime()),'Scheduled');
assert.equal(examAvailability(form,new Date('2026-09-20T08:00').getTime()),'Available');
assert.equal(examAvailability(form,new Date('2026-09-20T10:00').getTime()),'Expired');
assert.equal(toLocalDateTime('invalid'),'');
console.log('Passed exam validation and scheduling boundary checks.');
