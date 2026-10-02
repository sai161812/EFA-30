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
  {key:"currentPostalCode",label:"Postal code (optional)",type:"postal_code",aliases:["current postal code","postal code","zip code","postcode"]},
  {key:"currentCountry",label:"Country (optional)",type:"text",aliases:["current country","country","country name"]},
  {key:"company",label:"Company (optional)",type:"text",aliases:["company","company name","organization","organization name","employer"]},
  {key:"jobTitle",label:"Job title (optional)",type:"text",aliases:["job title","position","occupation"]},
  {key:"portfolio",label:"Website (optional)",type:"url",aliases:["website","website url","personal website","portfolio","portfolio url"]}
];
export function contactEditorFacts(facts) {
  return [
    ...CONTACT_FIELDS.map(field => facts.find(fact => fact.key === field.key) || {...field,value:"",source:"Entered by me"}),
    ...facts.filter(fact => !CONTACT_FIELDS.some(field => field.key === fact.key))
  ];
}
export function removeEmptyContactFacts(facts) {
  return facts.filter(fact => fact.value.trim() || !CONTACT_FIELDS.some(field => field.key === fact.key));
}


export function validateContactFacts(facts) {
  for (const fact of facts) {
    if (!fact.value.trim()) continue;
    if (fact.fact_type === "email" && !/^[^\s@]+@[^\s@]+$/.test(fact.value)) throw new Error("Enter a valid email address without spaces.");
    if (fact.fact_type === "url") {
      let url;
      try { url = new URL(fact.value); } catch { throw new Error("Enter a complete website URL starting with https:// or http://."); }
      if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("Website links must use HTTP or HTTPS and cannot contain credentials.");
    }
  }
}
