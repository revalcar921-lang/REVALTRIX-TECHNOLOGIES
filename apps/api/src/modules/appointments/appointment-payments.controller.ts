import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { Req } from '@nestjs/common';
import { CreateAppointmentSlotHoldDto, InitiateAppointmentDepositDto } from './dto/create-appointment-slot-hold.dto.js';
import { AppointmentPaymentsService } from './appointment-payments.service.js';

@Controller('v1/appointments/my')
@UseGuards(AccessTokenGuard, ThrottlerGuard)
export class AppointmentPaymentsController {
  constructor(private readonly payments: AppointmentPaymentsService) {}

  @Post('slot-holds')
  @Throttle({ default: { ttl: 60_000, limit: 8 } })
  createHold(@Req() request: AuthenticatedRequest, @Body() dto: CreateAppointmentSlotHoldDto) {
    return this.payments.createSlotHold(request.auth.userId, dto);
  }

  @Post('slot-holds/:holdId/payment')
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  initiateDeposit(
    @Req() request: AuthenticatedRequest,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
    @Body() dto: InitiateAppointmentDepositDto,
  ) {
    return this.payments.initiateDeposit(request.auth.userId, holdId, dto);
  }

  @Get('payments/:paymentIntentId')
  getPaymentStatus(
    @Req() request: AuthenticatedRequest,
    @Param('paymentIntentId', new ParseUUIDPipe()) paymentIntentId: string,
  ) {
    return this.payments.getPaymentStatus(request.auth.userId, paymentIntentId);
  }
}

@Controller('v1/appointments/payments/daraja')
@UseGuards(ThrottlerGuard)
export class DarajaAppointmentCallbackController {
  constructor(private readonly payments: AppointmentPaymentsService) {}

  @Post('callback/:token')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  callback(@Param('token') token: string, @Body() payload: unknown) {
    return this.payments.handleDarajaCallback(token, payload);
  }
}