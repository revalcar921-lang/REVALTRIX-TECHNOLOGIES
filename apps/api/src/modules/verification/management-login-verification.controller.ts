import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { VerificationService } from './verification.service.js';
import { VerifyCodeDto } from './dto/verify-code.dto.js';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';

@Controller('v1/verification')
@UseGuards(AccessTokenGuard)
export class ManagementLoginVerificationController {
  constructor(
    private readonly verificationService: VerificationService,
  ) {}

  @Post('management-login/request')
  requestManagementLoginVerification(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.verificationService.createManagementLoginVerification(
      request.auth.userId,
    );
  }

  @Post('management-login/verify')
  verifyManagementLoginCode(
    @Req() request: AuthenticatedRequest,
    @Body() dto: VerifyCodeDto,
  ) {
    return this.verificationService.verifyManagementLoginCode(
      request.auth.userId,
      dto.challengeId,
      dto.code,
    );
  }
}