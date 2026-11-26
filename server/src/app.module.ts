import { Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller'
import { AuthService } from './auth/auth.service'
import { DatabaseService } from './database/database.service'
import { StoreController } from './store/store.controller'
import { ChatbotController } from './chatbot.controller'
import { PaymentsService } from './payments/payments.service'

@Module({
  controllers: [AuthController, StoreController, ChatbotController],
  providers: [DatabaseService, AuthService, PaymentsService],
})
export class AppModule {}
