// testData.js — fully fictional sample/default values for the "Fill test values" tool. Kept in its own
// file so the whole test-fill feature can be removed or tree-shaken out for production by deleting this
// import. Nothing here is used unless the user clicks "Fill test values". No real holders, events, or
// addresses appear here — everything is invented for click-through testing.

const TEST_EMAIL = 'callasteven@gmail.com';

export const TEST_EVENT = {
  sanctionId: '123456',
  eventName: 'Summit Trail Test Race',
  eventLocationName: 'Riverside Test Park',
  eventAddress: '123 Example Avenue, Testville, CO 80000',
  eventStartDate: '08/16/2026',
  eventEndDate: '08/21/2026',
};

export const TEST_REQUESTOR = {
  name: 'Test Requestor',
  email: TEST_EMAIL,
  phone: '555-010-2026',
};

// The once-entered "Coverage & delivery" options (applied to every certificate). Sensible test defaults.
export const TEST_OPTIONS = {
  additionalInsured: true,
  aiPrimaryNonContrib: false,
  waiverOfSubrogation: true,
  noticeOfCancellation: false,
  coverageOther: false,
  coverageOtherText: '',
  contract: 'yes',              // 'yes' | 'no'
  relationship: 'landlord',     // 'landlord' | 'stateGov' | 'other'
  relationshipOtherText: '',
  additionalInfo: 'Test request — please disregard.',
  delivery: 'requestor',        // 'requestor' | 'requestorAndHolder' | 'other'
  deliveryOtherText: '',
};

// Invented holders mirroring the MASTER tab shape so the review table renders during Phase-1 UI review.
// Emails are pre-set to the test address so a test run is submit-ready in one click.
export const TEST_HOLDERS = [
  { name: 'Jane Testerson', address: '100 Sample Street', city: 'Testville', state: 'CO', zip: '80000', email: TEST_EMAIL },
  { name: 'Acme Test Rentals LLC', address: '200 Placeholder Road', city: 'Faketown', state: 'CO', zip: '80001', email: TEST_EMAIL },
  { name: 'John Q. Public', address: 'P.O. Box 123', city: 'Exampleburg', state: 'CO', zip: '80002', email: TEST_EMAIL },
  { name: 'Mountain View Test HOA', address: '300 Demo Drive', city: 'Testville', state: 'CO', zip: '80000', email: TEST_EMAIL },
  { name: 'Sample Family Trust', address: '400 Mock Lane', city: 'Faketown', state: 'CO', zip: '80001', email: TEST_EMAIL },
];
