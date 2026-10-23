import { Module } from '@nestjs/common';
import { AccountController } from './account.controller.js';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../../authorization/authorization.module.js';

@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [AccountController],
})
export class AccountModule {}
