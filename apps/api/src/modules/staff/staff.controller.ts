import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { PermissionGuard } from '../authorization/guards/permission.guard.js';
import { RequirePermission } from '../authorization/decorators/require-permission.decorator.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { AssignStaffDepartmentDto } from './dto/assign-staff-department.dto.js';
import { CreateStaffShiftDto } from './dto/create-staff-shift.dto.js';
import { UploadStaffDocumentDto } from './dto/upload-staff-document.dto.js';
import { ReviewStaffDocumentDto } from './dto/review-staff-document.dto.js';
import { CreateStaffTimeOffDto } from './dto/create-staff-time-off.dto.js';
import { ReviewStaffTimeOffDto } from './dto/review-staff-time-off.dto.js';
import { UpdateStaffDto } from './dto/update-staff.dto.js';
import { RequestVerificationDto } from '../verification/dto/request-verification.dto.js';
import { VerifyCodeDto } from '../verification/dto/verify-code.dto.js';
import { StaffService } from './staff.service.js';

@Controller('v1/staff')
@UseGuards(AccessTokenGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get('me')
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.staffService.getMyProfile(request.auth.userId);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'read')
  list(@Req() request: AuthenticatedRequest) {
    return this.staffService.list(request.auth.userId);
  }

  @Get('analytics')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'read')
  analytics(@Req() request: AuthenticatedRequest) {
    return this.staffService.getAnalytics(request.auth.userId);
  }

  @Get(':staffProfileId')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'read')
  getStaffProfile(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
  ) {
    return this.staffService.getStaffProfile(request.auth.userId, staffProfileId);
  }

  @Post(':staffProfileId/verification/request')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  requestContactVerification(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Body() dto: RequestVerificationDto,
  ) {
    return this.staffService.requestContactVerification(request.auth.userId, staffProfileId, dto.channel);
  }

  @Post(':staffProfileId/verification/verify')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  verifyContact(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Body() dto: VerifyCodeDto,
  ) {
    return this.staffService.verifyContact(request.auth.userId, staffProfileId, dto.challengeId, dto.code);
  }

  @Patch(':staffProfileId')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  updateProfile(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateProfile(request.auth.userId, staffProfileId, dto);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'create')
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateStaffDto) {
    return this.staffService.create(request.auth.userId, dto);
  }

  @Post('invite')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'invite')
  invite(@Req() request: AuthenticatedRequest, @Body() dto: CreateStaffDto) {
    return this.staffService.create(request.auth.userId, dto);
  }

  @Post(':staffProfileId/resend-invitation')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'invite')
  resendInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.resendInvitation(request.auth.userId, staffProfileId);
  }

  @Post(':staffProfileId/revoke-invitation')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'invite')
  revokeInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
  ) {
    return this.staffService.revokeInvitation(request.auth.userId, staffProfileId);
  }

  @Post(':staffProfileId/approve')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'invite')
  approveStaff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.approveStaff(request.auth.userId, staffProfileId);
  }

  @Get(':staffProfileId/access-history')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'view_access_history')
  getAccessHistory(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.getAccessHistory(request.auth.userId, staffProfileId);
  }

  @Get(':staffProfileId/documents')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'view_documents')
  listDocuments(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
  ) {
    return this.staffService.listDocuments(request.auth.userId, staffProfileId);
  }

  @Delete(':staffProfileId/photo')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  removePhoto(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
  ) {
    return this.staffService.removeProfilePhoto(request.auth.userId, staffProfileId);
  }

  @Get(':staffProfileId/photo')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'view_documents')
  async getPhoto(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Res() response: Response,
  ) {
    const photo = await this.staffService.downloadProfilePhoto(request.auth.userId, staffProfileId);
    response.setHeader('Content-Type', photo.contentType);
    response.setHeader('Content-Length', photo.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', 'inline');
    response.send(photo.buffer);
  }

  @Post(':staffProfileId/documents')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  uploadDocument(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Body() dto: UploadStaffDocumentDto,
    @UploadedFile()
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select a staff document to upload');
    return this.staffService.uploadDocument(request.auth.userId, staffProfileId, dto, file);
  }

  @Get(':staffProfileId/documents/:documentId/download')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'view_documents')
  async downloadDocument(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Res() response: Response,
  ) {
    const file = await this.staffService.downloadDocument(
      request.auth.userId,
      staffProfileId,
      documentId,
    );
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', file.buffer.length);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    response.send(file.buffer);
  }

  @Patch(':staffProfileId/documents/:documentId/review')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'verify_documents')
  reviewDocument(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() dto: ReviewStaffDocumentDto,
  ) {
    return this.staffService.reviewDocument(
      request.auth.userId,
      staffProfileId,
      documentId,
      dto,
    );
  }

  @Delete(':staffProfileId/documents/:documentId')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'update')
  deleteDocument(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return this.staffService.deleteDocument(request.auth.userId, staffProfileId, documentId);
  }

  @Post(':staffProfileId/assignments')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'assign_department')
  assignDepartment(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
    @Body() dto: AssignStaffDepartmentDto,
  ) {
    return this.staffService.assignDepartment(request.auth.userId, staffProfileId, dto);
  }

  @Delete(':staffProfileId/assignments/:assignmentId')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'assign_department')
  revokeDepartment(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Param('assignmentId', new ParseUUIDPipe()) assignmentId: string,
  ) {
    return this.staffService.revokeDepartment(
      request.auth.userId,
      staffProfileId,
      assignmentId,
    );
  }

  @Post(':staffProfileId/shifts')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'manage_shifts')
  createShift(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
    @Body() dto: CreateStaffShiftDto,
  ) {
    return this.staffService.createShift(request.auth.userId, staffProfileId, dto);
  }

  @Get(':staffProfileId/time-off')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'manage_shifts')
  listTimeOff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
  ) {
    return this.staffService.listTimeOff(request.auth.userId, staffProfileId);
  }

  @Post(':staffProfileId/time-off')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'manage_shifts')
  createTimeOff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Body() dto: CreateStaffTimeOffDto,
  ) {
    return this.staffService.createTimeOff(request.auth.userId, staffProfileId, dto);
  }

  @Patch(':staffProfileId/time-off/:timeOffId')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'manage_shifts')
  reviewTimeOff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId', new ParseUUIDPipe()) staffProfileId: string,
    @Param('timeOffId', new ParseUUIDPipe()) timeOffId: string,
    @Body() dto: ReviewStaffTimeOffDto,
  ) {
    return this.staffService.reviewTimeOff(request.auth.userId, staffProfileId, timeOffId, dto);
  }

  @Post(':staffProfileId/suspend')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'suspend')
  suspendStaff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.updateStatus(request.auth.userId, staffProfileId, 'SUSPENDED');
  }

  @Post(':staffProfileId/reactivate')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'suspend')
  reactivateStaff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.updateStatus(request.auth.userId, staffProfileId, 'ACTIVE');
  }

  @Post(':staffProfileId/offboard')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'offboard')
  offboardStaff(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.updateStatus(request.auth.userId, staffProfileId, 'OFFBOARDED');
  }

  @Post(':staffProfileId/reset-password')
  @UseGuards(PermissionGuard)
  @RequirePermission('staff', 'invite')
  sendPasswordReset(
    @Req() request: AuthenticatedRequest,
    @Param('staffProfileId') staffProfileId: string,
  ) {
    return this.staffService.sendPasswordReset(request.auth.userId, staffProfileId);
  }
}
