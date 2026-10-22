import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AppointmentDiscoveryQueryDto } from './dto/appointment-discovery-query.dto.js';
import { AppointmentSlotsQueryDto } from './dto/appointment-slots-query.dto.js';
import { AppointmentsService } from './appointments.service.js';

@Controller('v1/appointments/public/discovery')
@UseGuards(ThrottlerGuard)
export class AppointmentDiscoveryController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get('facilities')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  discoverFacilities(@Query() query: AppointmentDiscoveryQueryDto) {
    return this.appointments.discoverFacilities(query);
  }

  @Get('slots')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  discoverSlots(@Query() query: AppointmentSlotsQueryDto) {
    return this.appointments.discoverSlots(query);
  }
}