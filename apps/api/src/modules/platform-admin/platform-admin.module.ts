import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthenticationModule } from '../core/authentication/authentication.module.js';
import { PlatformAdminController } from './platform-admin.controller.js';

@Module({
  imports: [AuthenticationModule, AuthorizationModule, ConfigModule, DatabaseModule],
  controllers: [PlatformAdminController],
})
export class PlatformAdminModule {}
