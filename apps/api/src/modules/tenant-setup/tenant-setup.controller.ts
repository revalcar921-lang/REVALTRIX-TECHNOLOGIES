import { Body, Controller, Get, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { PermissionGuard } from '../authorization/guards/permission.guard.js';
import { RequirePermission } from '../authorization/decorators/require-permission.decorator.js';
import { TenantSetupService } from './tenant-setup.service.js';
import {
  AcceptTenantTermsDto,
  CreateOperationalResourceDto,
  UpdateBookingPolicyDto,
  UpdateOrganizationPaymentConfigDto,
  UploadTenantDocumentDto,
} from './dto/tenant-setup-config.dto.js';

@Controller('v1/tenant-setup')
@UseGuards(AccessTokenGuard)
export class TenantSetupController {
  constructor(private readonly tenantSetupService: TenantSetupService) {}

  @Get()
  async getSetup(@Req() request: AuthenticatedRequest) {
    return this.tenantSetupService.getSetup(request.auth.userId);
  }

  @Get('settings')
  async getSettings(@Req() request: AuthenticatedRequest) {
    return this.tenantSetupService.getTenantSettings(request.auth.userId);
  }

  @Patch('booking-policy')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  updateBookingPolicy(@Req() request: AuthenticatedRequest, @Body() dto: UpdateBookingPolicyDto) {
    return this.tenantSetupService.updateBookingPolicy(request.auth.userId, dto);
  }

  @Patch('payment-config')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  updatePaymentConfig(@Req() request: AuthenticatedRequest, @Body() dto: UpdateOrganizationPaymentConfigDto) {
    return this.tenantSetupService.updatePaymentConfig(request.auth.userId, dto);
  }

  @Post('resources')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  createResource(@Req() request: AuthenticatedRequest, @Body() dto: CreateOperationalResourceDto) {
    return this.tenantSetupService.createOperationalResource(request.auth.userId, dto);
  }

  @Post('compliance/documents')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadDocument(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UploadTenantDocumentDto,
    @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    return this.tenantSetupService.uploadTenantDocument(request.auth.userId, dto, file);
  }

  @Post('terms/accept')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  acceptTerms(@Req() request: AuthenticatedRequest, @Body() dto: AcceptTenantTermsDto) {
    return this.tenantSetupService.acceptTerms(request.auth.userId, dto, request.ip);
  }

  @Post('activation/validate')
  async validateActivation(@Req() request: AuthenticatedRequest) {
    return this.tenantSetupService.getSetup(request.auth.userId);
  }

  @Post('activation/request')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  async requestActivation(@Req() request: AuthenticatedRequest) {
    return this.tenantSetupService.requestActivation(request.auth.userId);
  }
}
