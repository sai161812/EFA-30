export const MESSAGE = Object.freeze({
  SCAN_ACTIVE_TAB: "pluma/scan-active-tab",
  SCAN_PAGE: "pluma/scan-page",
  SCAN_RESULT: "pluma/scan-result",
  SCAN_ERROR: "pluma/scan-error"
});

/**
 * @typedef {Object} FieldDescriptor
 * @property {string} id Temporary identity for this scan only.
 * @property {string} kind Element kind, such as "input" or "textarea".
 * @property {string} label Safe-to-render field label.
 * @property {string} autocomplete Autocomplete tokens, if present.
 * @property {string} name HTML name attribute, if present.
 * @property {string} inputType Input type or element kind.
 * @property {boolean} hasValue Whether a value exists; never the value itself.
 * @property {boolean} eligible Whether Phase 0 considers the control scannable.
 */
/** @typedef {{key:string, label:string, type:string, value:string, source:string, updatedAt:string}} ProfileFact */
/** @typedef {{fieldId:string, profileKey:string|null, status:string, reason:string}} MatchProposal */
/** @typedef {{tabId:number, origin:string, profileId:string, values:Array<{fieldId:string,value:string}>}} ApprovedFill */
/** @typedef {{fieldId:string, status:string, message:string}} Outcome */

// Phase 0 field descriptors intentionally contain no field values.
export const SHAPES = Object.freeze({
  fieldDescriptor: ["id", "kind", "label", "autocomplete", "name", "inputType", "hasValue", "eligible"],
  profileFact: ["key", "label", "type", "value", "source", "updatedAt"],
  matchProposal: ["fieldId", "profileKey", "status", "reason"],
  approvedFill: ["tabId", "origin", "profileId", "values"],
  outcome: ["fieldId", "status", "message"]
});

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isMessageType(value, expectedType) {
  return isObject(value) && value.type === expectedType;
}
