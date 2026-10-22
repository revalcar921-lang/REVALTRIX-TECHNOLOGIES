import { BadRequestException } from '@nestjs/common';

export function normalizeKenyanPhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, '');
  const digits = compact.startsWith('+') ? compact.slice(1) : compact;
  const normalized = digits.startsWith('0') ? `254${digits.slice(1)}` : digits;
  if (!/^254[17]\d{8}$/.test(normalized)) {
    throw new BadRequestException('Enter a valid Kenyan Safaricom mobile number, such as 0712345678 or +254712345678.');
  }
  return normalized;
}