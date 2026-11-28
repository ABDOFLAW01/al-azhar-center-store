import { Module } from '@nestjs/common'
import { AuthController } from './auth/auth.controller.js'
import { AuthService } from './auth/auth.service.js'
import { DatabaseService } from './database/database.service.js'
import { StoreController } from './store/store.controller.js'
import { ChatbotController } from './chatbot.controller.js'
import { PaymentsService } from './payments/payments.service.js'

@Module({
  controllers: [AuthController, StoreController, ChatbotController],
  providers: [DatabaseService, AuthService, PaymentsService],
})
export class AppModule {}