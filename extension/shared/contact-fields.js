export const CONTACT_FIELDS = [
  {key:"fullName",label:"Full name",type:"text",aliases:["name","full name","your name","contact name"]},
  {key:"firstName",label:"First name",type:"text",aliases:["first name","given name","firstname"]},
  {key:"lastName",label:"Last name",type:"text",aliases:["last name","family name","surname","lastname"]},
  {key:"email",label:"Email",type:"email",aliases:["email","email address","your email","contact email","e mail"]},
  {key:"phone",label:"Phone (include country code)",type:"phone",aliases:["phone","phone number","telephone","mobile","mobile number","contact number"]},
  {key:"username",label:"Username (optional)",type:"text",aliases:["username","user name","preferred username"]},
  {key:"currentAddressLine1",label:"Address line 1 (optional)",type:"text",aliases:["current address line 1","address line 1","street address","street"]},
  {key:"currentAddressLine2",label:"Address line 2 (optional)",type:"text",aliases:["current address line 2","address line 2","apartment","suite"]},
  {key:"currentCity",label:"City (optional)",type:"text",aliases:["current city","city","town"]},
  {key:"currentRegion",label:"State or province (optional)",type:"text",aliases:["current state","state","province","region"]},
  {key:"currentPostalCode",label:"Postal code (optional)",type:"postal_code",aliases:["current postal code","postal code","zip code","postcode","pin code","pincode"]},
  {key:"currentCountry",label:"Country (optional)",type:"text",aliases:["current country","country","country name"]},
  {key:"company",label:"Company (optional)",type:"text",aliases:["company","company name","organization","organization name","employer"]},
  {key:"jobTitle",label:"Job title (optional)",type:"text",aliases:["job title","position","occupation"]},
  {key:"portfolio",label:"Website (optional)",type:"url",aliases:["website","website url","personal website","portfolio","portfolio url"]}
];
export const PROFILE_FIELDS = {
  personal: CONTACT_FIELDS,
  college: [...CONTACT_FIELDS,
    {key:"college",label:"College or university (optional)",type:"text",aliases:["college","university","institution","school name"]},
    {key:"collegeEmail",label:"College email (optional)",type:"email",aliases:["college email","university email","student email","academic email"]},
    {key:"degree",label:"Degree (optional)",type:"text",aliases:["degree","degree program","qualification"]},
    {key:"studyYear",label:"Year of study (optional)",type:"text",aliases:["year of study","current year of study","class standing","year in school"]},
    {key:"graduationYear",label:"Graduation year (optional)",type:"year",aliases:["graduation year","year of graduation"]},
    {key:"graduationDate",label:"Full graduation date, YYYY-MM-DD (optional)",type:"date",datePrecision:"day",aliases:["graduation date","expected graduation date"]}
  ],
  professional: [...CONTACT_FIELDS,
    {key:"github",label:"GitHub URL (optional)",type:"url",aliases:["github","github profile","github url"]}
  ]
};
export const ALL_PROFILE_FIELDS = [...new Map(Object.values(PROFILE_FIELDS).flat().map(field => [field.key,field])).values()];
export function contactEditorFacts(facts, profileType = "personal") {
  const fields = PROFILE_FIELDS[profileType] || CONTACT_FIELDS;
  return [
    ...fields.map(field => facts.find(fact => fact.key === field.key) || {...field,value:"",source:"Entered by me"}),
    ...facts.filter(fact => !fields.some(field => field.key === fact.key))
  ];
}
export function removeEmptyContactFacts(facts) {
  return facts.filter(fact => fact.value.trim() || !ALL_PROFILE_FIELDS.some(field => field.key === fact.key));
}


export function validateContactFacts(facts) {
  for (const fact of facts) {
    if (!fact.value.trim()) continue;
    if (fact.fact_type === "email" && !/^[^\s@]+@[^\s@]+$/.test(fact.value)) throw new Error("Enter a valid email address without spaces.");
    if (fact.fact_type === "year" && !/^[1-9][0-9]{3}$/.test(fact.value)) throw new Error("Enter a four-digit year.");
    if (fact.fact_type === "date") {
      const precision = fact.date_precision;
      const pattern = precision === "year" ? /^[1-9][0-9]{3}$/ : precision === "month" ? /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/ : precision === "day" ? /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/ : null;
      if (!pattern || !pattern.test(fact.value)) throw new Error("Enter a date matching its selected Year, Month or Day precision.");
      if (precision === "day") {
        const parsed = new Date(`${fact.value}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== fact.value) throw new Error("Enter a valid calendar date.");
      }
    }
    if (fact.fact_type === "url") {
      let url;
      try { url = new URL(fact.value); } catch { throw new Error("Enter a complete website URL starting with https:// or http://."); }
      if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("Website links must use HTTP or HTTPS and cannot contain credentials.");
    }
  }
}
