import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CrmModule } from '../crm/crm.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [AuthModule, TenancyModule, CrmModule, InventoryModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
