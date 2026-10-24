import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../core/authentication/guards/access-token.guard.js';
import type { AuthenticatedRequest } from '../core/authentication/guards/access-token.guard.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { PrivateObjectStorageService } from '../storage/private-object-storage.service.js';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  CreateTenantWebsiteEnquiryDto,
  TenantWebsiteAppointmentDto,
  TenantWebsiteSlotSearchDto,
  UpdateTenantWebsiteDto,
  UpdateTenantWebsiteEnquiryDto,
} from './dto/tenant-website.dto.js';
import { TenantWebsitesService } from './tenant-websites.service.js';

@Controller('v1/tenant-websites')
export class TenantWebsitesController {
  constructor(
    private readonly websites: TenantWebsitesService,
    private readonly storage: PrivateObjectStorageService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  @UseGuards(AccessTokenGuard)
  getMyWebsite(@Req() request: AuthenticatedRequest) {
    return this.websites.getAdminWebsite(request.auth.userId);
  }

  @Get('me/status')
  @UseGuards(AccessTokenGuard)
  getWebsiteStatus(@Req() request: AuthenticatedRequest) {
    return this.websites.getWebsiteStatus(request.auth.userId);
  }

  @Put('me')
  @UseGuards(AccessTokenGuard)
  updateDraft(@Req() request: AuthenticatedRequest, @Body() dto: UpdateTenantWebsiteDto) {
    return this.websites.updateDraft(request.auth.userId, dto);
  }

  @Post('me/publish')
  @UseGuards(AccessTokenGuard)
  publish(@Req() request: AuthenticatedRequest) {
    return this.websites.publish(request.auth.userId);
  }

  @Post('me/unpublish')
  @UseGuards(AccessTokenGuard)
  unpublish(@Req() request: AuthenticatedRequest) {
    return this.websites.unpublish(request.auth.userId);
  }

  @Post('me/revisions/:revisionId/restore')
  @UseGuards(AccessTokenGuard)
  restoreRevision(
    @Req() request: AuthenticatedRequest,
    @Param('revisionId', new ParseUUIDPipe()) revisionId: string,
  ) {
    return this.websites.restoreRevision(request.auth.userId, revisionId);
  }

  @Get('me/enquiries')
  @UseGuards(AccessTokenGuard)
  listEnquiries(@Req() request: AuthenticatedRequest) {
    return this.websites.listEnquiries(request.auth.userId);
  }

  @Patch('me/enquiries/:enquiryId')
  @UseGuards(AccessTokenGuard)
  updateEnquiry(
    @Req() request: AuthenticatedRequest,
    @Param('enquiryId', new ParseUUIDPipe()) enquiryId: string,
    @Body() dto: UpdateTenantWebsiteEnquiryDto,
  ) {
    return this.websites.updateEnquiry(request.auth.userId, enquiryId, dto);
  }

  @Get('public/:slug')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  getPublicWebsite(@Param('slug') slug: string) {
    return this.websites.getPublicWebsite(slug);
  }

  @Post('public/:slug/enquiries')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  createEnquiry(@Param('slug') slug: string, @Body() dto: CreateTenantWebsiteEnquiryDto) {
    return this.websites.createEnquiry(slug, dto);
  }

  @Post('public/:slug/slots')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  discoverSlots(@Param('slug') slug: string, @Body() dto: TenantWebsiteSlotSearchDto) {
    return this.websites.discoverSlots(slug, dto);
  }

  @Post('public/:slug/appointments')
  @UseGuards(AccessTokenGuard)
  createAppointment(
    @Req() request: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: TenantWebsiteAppointmentDto,
  ) {
    return this.websites.createAppointment(request.auth.userId, slug, dto);
  }

  @Post('me/gallery-upload')
  @UseGuards(AccessTokenGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async uploadGalleryImage(
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  ) {
    if (!file) throw new BadRequestException('Select an image to upload');

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, WEBP, GIF, and SVG images are accepted');
    }

    const extension = file.mimetype.split('/')[1] === 'svg+xml' ? 'svg' : file.mimetype.split('/')[1];
    const tenantId = request.auth.tenantId;
    const storageKey = `tenant/${tenantId}/website-gallery/${randomUUID()}.${extension}`;

    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const endpoint = this.config.get<string>('storage.endpoint')?.trim();
    const bucket = this.config.get<string>('storage.bucket')?.trim();
    if (!endpoint || !bucket) {
      throw new BadRequestException('Storage is not configured for public gallery uploads.');
    }

    const publicUrl = `${endpoint}/${bucket}/${storageKey}`;
    return { url: publicUrl };
  }
}