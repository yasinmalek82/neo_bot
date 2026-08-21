import { DomainConflictError, type SalesOrder } from '@neo-bot/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';

import { CustomerOrderService } from './customer-order.service.js';
import { customerOrderServiceToken } from './customer.provider.js';

const createOrderSchema = z
  .object({
    productVariantId: z.string().regex(/^\d+$/u),
  })
  .strict();

@Controller('customer')
export class CustomerController {
  public constructor(
    @Inject(customerOrderServiceToken)
    private readonly orders: CustomerOrderService | null,
  ) {}

  @Post('orders')
  public async createOrder(
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const service = this.requireService();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_ORDER_PAYLOAD');
    }
    try {
      const created = await service.createOrder(
        this.requireInitData(initData),
        parsed.data.productVariantId,
        idempotencyKey,
      );
      return serializeCustomerOrder(created.order, created.payment);
    } catch (error: unknown) {
      throw mapCustomerError(error);
    }
  }

  @Get('orders/current')
  public async currentOrder(@Headers('x-telegram-init-data') initData: string | undefined) {
    const service = this.requireService();
    try {
      const result = await service.currentOrder(this.requireInitData(initData));
      return serializeCustomerOrder(result.order, result.payment);
    } catch (error: unknown) {
      throw mapCustomerError(error);
    }
  }

  private requireService(): CustomerOrderService {
    if (this.orders === null) {
      throw new ServiceUnavailableException('CUSTOMER_API_DISABLED');
    }
    return this.orders;
  }

  private requireInitData(initData: string | undefined): string {
    if (initData === undefined || initData.length === 0) {
      throw new UnauthorizedException('INIT_DATA_REQUIRED');
    }
    return initData;
  }
}

function serializeCustomerOrder(
  order: SalesOrder | null,
  payment: { readonly cardNumber: string; readonly cardHolder: string } | null,
) {
  return {
    order:
      order === null
        ? null
        : {
            id: order.id,
            productName: order.productName,
            variantName: order.variantName,
            amountIrr: order.amountIrr.toString(),
            status: order.status,
          },
    payment,
  };
}

function mapCustomerError(error: unknown): Error {
  if (error instanceof DomainConflictError) {
    if (error.code === 'INIT_DATA_INVALID' || error.code === 'INIT_DATA_EXPIRED') {
      return new UnauthorizedException(error.code);
    }
    return new ConflictException(error.code);
  }
  if (error instanceof Error) {
    return error;
  }
  return new ConflictException('CUSTOMER_REQUEST_FAILED');
}
