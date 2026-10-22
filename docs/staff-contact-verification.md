# Staff Contact and Document Verification

## Contact OTP

Email codes use the configured verification email service. Phone codes use Africa's Talking and are sent only when all of these server environment variables are set:

- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_SENDER_ID` (optional, if approved for the account)

The API does not report a phone code as sent unless Africa's Talking accepts the recipient. A code is six digits, expires after ten minutes, and is limited to five verification attempts. Staff enter the received code in the Verification & documents tab. The challenge is bound to the staff account and the current saved email/phone; codes are never logged.

## Uploaded files

Uploads are stored privately and checked automatically for size and matching file signature. Those checks establish that the file resembles its declared PDF or image format; they do not establish that an identity document, license, or certificate is genuine. Documents remain pending until an authorized reviewer checks the contents and records a verification decision.