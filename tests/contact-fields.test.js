import test from "node:test";
import assert from "node:assert/strict";
import {contactEditorFacts,removeEmptyContactFacts,validateContactFacts} from "../extension/shared/contact-fields.js";
import {matchField} from "../extension/matching/matcher.js";

test("guided contact setup preserves existing facts and custom metadata", () => {
  const email={key:"email",label:"My email",type:"email",value:"a@example.test",aliases:["my email"],source:"Existing"};
  const custom={key:"customFact",label:"Custom",value:"",aliases:[],source:"Existing"};
  const rows=contactEditorFacts([email,custom]);
  assert.equal(rows.find(fact => fact.key === "email"),email);
  assert.equal(rows.find(fact => fact.key === "customFact"),custom);
  assert.deepEqual(removeEmptyContactFacts(rows),[email,custom]);
  assert.equal(rows.find(fact => fact.key === "firstName").value,"");
  assert.equal(rows.find(fact => fact.key === "lastName").value,"");
});

test("default contact aliases match common signup labels without guessing name parts", () => {
  const facts=contactEditorFacts([]).map(fact => ({...fact,value:fact.key === "fullName" ? "Avery Example" : fact.key === "email" ? "a@example.test" : ""}));
  const field={kind:"input",inputType:"text",eligible:true,ariaLabels:[],instructions:[],context:"",maxLength:-1};
  assert.equal(matchField({...field,label:"Your name"},facts).profileKey,"fullName");
  assert.equal(matchField({...field,label:"Your email",inputType:"email"},facts).profileKey,"email");
  assert.equal(matchField({...field,label:"First name"},facts).status,"missing value");
});


test("saved contact values reject malformed emails and unsafe website links", () => {
  assert.throws(() => validateContactFacts([{fact_type:"email",value:"not an email"}]),/valid email/);
  for(const value of ["javascript:alert(1)","https://user:secret@example.test/"]) {
    assert.throws(() => validateContactFacts([{fact_type:"url",value}]),/cannot contain credentials/);
  }
  assert.doesNotThrow(() => validateContactFacts([{fact_type:"email",value:"a@example.test"},{fact_type:"url",value:"https://example.test/"}]));
});


test("college and work setup offer relevant optional details without copying another identity", () => {
  const college=contactEditorFacts([],"college");
  assert.ok(college.some(fact=>fact.key==="collegeEmail"));
  assert.ok(college.some(fact=>fact.key==="graduationDate" && fact.datePrecision==="day"));
  assert.ok(contactEditorFacts([],"professional").some(fact=>fact.key==="github"));
  assert.deepEqual(removeEmptyContactFacts(college),[]);
  assert.ok(college.every(fact=>fact.value===""));
});

test("date values retain explicit precision and reject impossible dates", () => {
  assert.throws(()=>validateContactFacts([{fact_type:"date",value:"2027-02-30",date_precision:"day"}]),/valid calendar/);
  assert.throws(()=>validateContactFacts([{fact_type:"date",value:"2027",date_precision:"day"}]),/precision/);
  assert.doesNotThrow(()=>validateContactFacts([{fact_type:"date",value:"2027",date_precision:"year"}]));
});


test("Indian postal PIN labels resolve to the saved postal component", () => {
  const facts=contactEditorFacts([]).map(fact=>({...fact,value:fact.key === "currentPostalCode" ? "005501" : ""}));
  const field={kind:"input",inputType:"text",eligible:true,ariaLabels:[],instructions:[],context:"",maxLength:-1};
  for (const label of ["PIN code","Pincode"]) {
    const result=matchField({...field,label},facts);
    assert.equal(result.status,"matched");
    assert.equal(result.profileKey,"currentPostalCode");
    assert.equal(facts.find(fact => fact.key === result.profileKey).value,"005501");
  }
});
