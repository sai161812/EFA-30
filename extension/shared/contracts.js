export const MESSAGE = Object.freeze({
  SCAN_ACTIVE_TAB: "pluma/scan-active-tab",
  GET_PREVIEW: "pluma/get-preview",
  UPDATE_PREVIEW: "pluma/update-preview",
  CANCEL_PREVIEW: "pluma/cancel-preview",
  APPROVE_AND_FILL: "pluma/approve-and-fill",
  SCAN_PAGE: "pluma/scan-page",
  SCAN_RESULT: "pluma/scan-result",
  FILL_APPROVED: "pluma/fill-approved",
  FILL_RESULT: "pluma/fill-result",
  WORKFLOW_ERROR: "pluma/workflow-error",
  API_LOGIN: "pluma/api-login",
  API_CONFIGURE: "pluma/api-configure",
  API_SELECT_PROFILE: "pluma/api-select-profile",
  API_LOGOUT: "pluma/api-logout",
  API_STATUS: "pluma/api-status",
  API_LIST_PROFILES: "pluma/api-list-profiles",
  API_READ_PROFILE: "pluma/api-read-profile",
  API_CREATE_PROFILE: "pluma/api-create-profile",
  API_UPDATE_PROFILE: "pluma/api-update-profile"
});

/**
 * @typedef {Object} FieldDescriptor
 * @property {string} id Temporary DOM identity for the current document.
 * @property {string} kind HTML element kind.
 * @property {string} label Associated or accessible label, bounded for display.
 * @property {string[]} ariaLabels Resolved accessibility labels.
 * @property {string[]} instructions Bounded accessibility descriptions/nearby instructions; treated as untrusted page text.
 * @property {string} autocomplete Autocomplete attribute tokens.
 * @property {string} name HTML name attribute.
 * @property {string} domId HTML id attribute.
 * @property {string} placeholder Placeholder text.
 * @property {string} context Bounded form/group context.
 * @property {Array<{value:string,label:string,disabled:boolean}>} options Bounded native option descriptors; present for select controls.
 * @property {number} maxLength Field limit, or -1 when there is no declared limit.
 * @property {string} inputType Input type or control kind.
 * @property {boolean} hasValue Whether the field currently has a value; never the value itself.
 * @property {boolean} eligible Whether the control is safe and supported for this phase.
 * @property {string} unsupportedReason Why a control is excluded, when applicable.
 * @property {number} revision Local edit counter, never page content.
 */
/** @typedef {{key:string, label:string, type:string, value:string, source:string, updatedAt:string, aliases:string[], date_precision?:string|null}} ProfileFact */
/** @typedef {{fieldId:string, profileKey:string|null, status:'matched'|'needs choice'|'missing value'|'unsupported', reason:string}} MatchProposal */
/** @typedef {{tabId:number, documentId:string, origin:string, profileId:string, profileVersion:number, values:Array<{fieldId:string,value:string,overwrite:boolean}>}} ApprovedFill */
/** @typedef {{fieldId:string, status:'filled'|'skipped'|'failed', message:string}} Outcome */

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isMessageType(value, expectedType) {
  return isObject(value) && value.type === expectedType;
}
