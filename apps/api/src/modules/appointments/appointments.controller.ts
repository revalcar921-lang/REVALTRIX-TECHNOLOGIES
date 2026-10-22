import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import { PermissionGuard } from '../authorization/guards/permission.guard.js';
import { RequirePermission } from '../authorization/decorators/require-permission.decorator.js';
import { AppointmentStatus } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { AppointmentQueryDto } from './dto/appointment-query.dto.js';
import { AppointmentSlotsQueryDto } from './dto/appointment-slots-query.dto.js';
import { TransitionAppointmentDto } from './dto/transition-appointment.dto.js';
import { RequestAppointmentRefundDto, ReviewAppointmentRefundDto } from './dto/appointment-refund.dto.js';
import { AppointmentsService } from './appointments.service.js';

@Controller('v1/appointments')
@UseGuards(AccessTokenGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get('my')
  myAppointments(@Req() request: AuthenticatedRequest) {
    return this.appointmentsService.listForPatient(request.auth.userId);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: AppointmentQueryDto,
  ) {
    return this.appointmentsService.listForStaff(request.auth.userId, query);
  }

  @Get('discovery/facilities')
  discoverFacilities() {
    return this.appointmentsService.discoverFacilities();
  }

  @Get('discovery/slots')
  discoverSlots(@Query() query: AppointmentSlotsQueryDto) {
    return this.appointmentsService.discoverSlots(query);
  }

  @Get('my/booking-eligibility')
  bookingEligibility(
    @Req() request: AuthenticatedRequest,
    @Query('tenantId') tenantId: string,
  ) {
    return this.appointmentsService.getPatientBookingEligibility(request.auth.userId, tenantId);
  }

  @Post('my/:appointmentId/refund-request')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  requestRefund(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Body() dto: RequestAppointmentRefundDto,
  ) {
    return this.appointmentsService.requestPatientRefund(request.auth.userId, appointmentId, dto);
  }

  @Get(':appointmentId')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'read')
  getById(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
  ) {
    return this.appointmentsService.getForStaff(
      request.auth.userId,
      appointmentId,
    );
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'create')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.createForStaff(request.auth.userId, dto);
  }

  @Post(':appointmentId/confirm')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.CONFIRMED,
      dto,
    );
  }

  @Post(':appointmentId/check-in')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  checkIn(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.CHECKED_IN,
      dto,
    );
  }

  @Post(':appointmentId/start')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  start(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.IN_PROGRESS,
      dto,
    );
  }

  @Post(':appointmentId/complete')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  complete(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.COMPLETED,
      dto,
    );
  }

  @Post(':appointmentId/cancel')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.CANCELLED,
      dto,
    );
  }

  @Post(':appointmentId/no-show')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  noShow(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.NO_SHOW,
      dto,
    );
  }

  @Post(':appointmentId/reject')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  reject(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId') appointmentId: string,
    @Body() dto: TransitionAppointmentDto,
  ) {
    return this.appointmentsService.transitionForStaff(
      request.auth.userId,
      appointmentId,
      AppointmentStatus.REJECTED,
      dto,
    );
  }

  @Post(':appointmentId/refunds/:refundId/review')
  @UseGuards(PermissionGuard)
  @RequirePermission('appointments', 'update')
  reviewRefund(
    @Req() request: AuthenticatedRequest,
    @Param('appointmentId', new ParseUUIDPipe()) appointmentId: string,
    @Param('refundId', new ParseUUIDPipe()) refundId: string,
    @Body() dto: ReviewAppointmentRefundDto,
  ) {
    return this.appointmentsService.reviewAppointmentRefund(request.auth.userId, appointmentId, refundId, dto);
  }
}
