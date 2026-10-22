import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { PermissionGuard } from '../authorization/guards/permission.guard.js';
import { RequirePermission } from '../authorization/decorators/require-permission.decorator.js';
import { PlatformPermissionGuard } from '../authorization/guards/platform-permission.guard.js';
import { RequirePlatformPermission } from '../authorization/decorators/require-platform-permission.decorator.js';
import { FamilyStepUpGuard } from '../patient-family/family-step-up.guard.js';
import { RequireFamilyStepUp } from '../patient-family/require-family-step-up.decorator.js';
import { TenantSetupService } from './tenant-setup.service.js';
import { TenantOwnershipService } from './tenant-ownership.service.js';
import {
  AcceptTenantTermsDto,
  CreateOperationalResourceDto,
  UpdateBookingPolicyDto,
  UpdateOrganizationPaymentConfigDto,
  UploadTenantDocumentDto,
  ReviewOwnershipPartyDto,
  ReviewTenantActivationDto,
  ReviewTenantDocumentDto,
  SaveOwnershipPartyDto,
  SubmitOwnershipDeclarationDto,
  UploadOwnershipEvidenceDto,
} from './dto/tenant-setup-config.dto.js';

@Controller('v1/tenant-setup')
@UseGuards(AccessTokenGuard)
export class TenantSetupController {
  constructor(
    private readonly tenantSetupService: TenantSetupService,
    private readonly tenantOwnershipService: TenantOwnershipService,
  ) {}

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

  @Get('ownership')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'read')
  listOwnership(@Req() request: AuthenticatedRequest) {
    return this.tenantOwnershipService.listMine(request.auth.userId);
  }

  @Post('ownership/parties')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  createOwnershipParty(@Req() request: AuthenticatedRequest, @Body() dto: SaveOwnershipPartyDto) {
    return this.tenantOwnershipService.createParty(request.auth.userId, dto);
  }

  @Patch('ownership/parties/:partyId')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  updateOwnershipParty(
    @Req() request: AuthenticatedRequest,
    @Param('partyId', new ParseUUIDPipe()) partyId: string,
    @Body() dto: SaveOwnershipPartyDto,
  ) {
    return this.tenantOwnershipService.updateParty(request.auth.userId, partyId, dto);
  }

  @Delete('ownership/parties/:partyId')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  removeOwnershipParty(@Req() request: AuthenticatedRequest, @Param('partyId', new ParseUUIDPipe()) partyId: string) {
    return this.tenantOwnershipService.removeParty(request.auth.userId, partyId);
  }

  @Post('ownership/parties/:partyId/evidence')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadOwnershipEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('partyId', new ParseUUIDPipe()) partyId: string,
    @Body() dto: UploadOwnershipEvidenceDto,
    @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select an evidence file to upload');
    return this.tenantOwnershipService.uploadEvidence(request.auth.userId, partyId, dto, file);
  }

  @Delete('ownership/parties/:partyId/evidence/:evidenceId')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  removeOwnershipEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('partyId', new ParseUUIDPipe()) partyId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
  ) {
    return this.tenantOwnershipService.deleteReviewEvidence(request.auth.userId, partyId, evidenceId);
  }

  @Post('ownership/submit')
  @UseGuards(PermissionGuard)
  @RequirePermission('organization', 'update')
  submitOwnership(@Req() request: AuthenticatedRequest, @Body() dto: SubmitOwnershipDeclarationDto) {
    return this.tenantOwnershipService.submitDeclaration(request.auth.userId, dto);
  }

  @Get('admin/ownership')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('tenant_ownership', 'review')
  listOwnershipForReview() {
    return this.tenantOwnershipService.listPendingReviews();
  }

  @Get('admin/ownership/access')
  ownershipReviewAccess(@Req() request: AuthenticatedRequest) {
    return this.tenantOwnershipService.canReview(request.auth.userId);
  }

  @Get('admin/approvals/access')
  async approvalsAccess(@Req() request: AuthenticatedRequest) {
    return this.tenantOwnershipService.canReviewSuperAdmin(request.auth.userId);
  }

  @Get('admin/documents')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('super_admin', 'review_approvals')
  listPendingDocuments() {
    return this.tenantSetupService.listPendingTenantDocuments();
  }

  @Get('admin/documents/:documentId/download')
  @UseGuards(PlatformPermissionGuard, FamilyStepUpGuard)
  @RequirePlatformPermission('super_admin', 'review_approvals')
  @RequireFamilyStepUp()
  async downloadTenantDocument(
    @Req() request: AuthenticatedRequest,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Res() response: Response,
  ) {
    const file = await this.tenantSetupService.downloadTenantReviewDocument(request.auth.userId, documentId);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(file.buffer);
  }

  @Post('admin/documents/:documentId/review')
  @UseGuards(PlatformPermissionGuard, FamilyStepUpGuard)
  @RequirePlatformPermission('super_admin', 'review_approvals')
  @RequireFamilyStepUp()
  reviewTenantDocument(
    @Req() request: AuthenticatedRequest,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() dto: ReviewTenantDocumentDto,
  ) {
    return this.tenantSetupService.reviewTenantDocument(request.auth.userId, documentId, dto);
  }

  @Get('admin/activations')
  @UseGuards(PlatformPermissionGuard)
  @RequirePlatformPermission('super_admin', 'review_approvals')
  listPendingActivations() {
    return this.tenantSetupService.listPendingActivations();
  }

  @Post('admin/activations/:tenantId/review')
  @UseGuards(PlatformPermissionGuard, FamilyStepUpGuard)
  @RequirePlatformPermission('super_admin', 'review_approvals')
  @RequireFamilyStepUp()
  reviewActivation(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() dto: ReviewTenantActivationDto,
  ) {
    return this.tenantSetupService.reviewActivation(request.auth.userId, tenantId, dto);
  }

  @Get('admin/ownership/:partyId/evidence/:evidenceId')
  @UseGuards(PlatformPermissionGuard, FamilyStepUpGuard)
  @RequirePlatformPermission('tenant_ownership', 'review')
  @RequireFamilyStepUp()
  async downloadOwnershipEvidence(
    @Req() request: AuthenticatedRequest,
    @Param('partyId', new ParseUUIDPipe()) partyId: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
    @Res() response: Response,
  ) {
    const file = await this.tenantOwnershipService.downloadReviewEvidence(request.auth.userId, partyId, evidenceId);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(file.buffer);
  }

  @Post('admin/ownership/:partyId/review')
  @UseGuards(PlatformPermissionGuard, FamilyStepUpGuard)
  @RequirePlatformPermission('tenant_ownership', 'review')
  @RequireFamilyStepUp()
  reviewOwnershipParty(
    @Req() request: AuthenticatedRequest,
    @Param('partyId', new ParseUUIDPipe()) partyId: string,
    @Body() dto: ReviewOwnershipPartyDto,
  ) {
    return this.tenantOwnershipService.reviewParty(request.auth.userId, partyId, dto);
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
