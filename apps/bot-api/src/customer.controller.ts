import { DomainConflictError, type SalesOrder } from '@neo-bot/domain';
import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  GoneException,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';

import { CustomerOrderService } from './customer-order.service.js';
import { customerOrderServiceToken } from './customer.provider.js';

const categoryIdSchema = z.string().regex(/^\d+$/u);

interface CustomerShopCategorySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface CustomerShopVariantSummary {
  readonly id: string;
  readonly productName: string;
  readonly name: string;
  readonly description: string;
  readonly durationDays: number;
  readonly volumeLabel: string;
  readonly deviceLabel: string;
  readonly priceToman: number;
}

interface CustomerShopCategoriesResponse {
  readonly categories: readonly CustomerShopCategorySummary[];
  readonly emptyHint: 'admin' | 'customer' | null;
}

interface CustomerShopCategoryResponse {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parent: { readonly id: string; readonly name: string } | null;
  readonly categories: readonly CustomerShopCategorySummary[];
  readonly variants: readonly CustomerShopVariantSummary[];
}

@Controller('customer')
export class CustomerController {
  public constructor(
    @Inject(customerOrderServiceToken)
    private readonly orders: CustomerOrderService | null,
  ) {}

  @Get('shop/categories')
  public async listShopCategories(
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Query('parentId') parentId: string | undefined,
  ): Promise<CustomerShopCategoriesResponse> {
    const service = this.requireService();
    let parent: string | null = null;
    if (parentId !== undefined && parentId.length > 0) {
      const parsedParent = categoryIdSchema.safeParse(parentId);
      if (!parsedParent.success) {
        throw new BadRequestException('INVALID_CATEGORY_ID');
      }
      parent = parsedParent.data;
    }
    try {
      return await service.listShopCategories(this.requireInitData(initData), parent);
    } catch (error: unknown) {
      throw mapCustomerError(error);
    }
  }

  @Get('shop/categories/:categoryId')
  public async getShopCategory(
    @Headers('x-telegram-init-data') initData: string | undefined,
    @Param('categoryId') categoryId: string,
  ): Promise<CustomerShopCategoryResponse> {
    const service = this.requireService();
    const parsed = categoryIdSchema.safeParse(categoryId);
    if (!parsed.success) {
      throw new BadRequestException('INVALID_CATEGORY_ID');
    }
    try {
      return await service.getShopCategory(this.requireInitData(initData), parsed.data);
    } catch (error: unknown) {
      throw mapCustomerError(error);
    }
  }

  @Post('orders')
  public createOrder(): never {
    throw new GoneException('CHAT_CHECKOUT_REQUIRED');
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

  @Get('service')
  public async currentService(@Headers('x-telegram-init-data') initData: string | undefined) {
    const service = this.requireService();
    try {
      return await service.hasActiveService(this.requireInitData(initData));
    } catch (error: unknown) {
      throw mapCustomerError(error);
    }
  }

  @Post('renew')
  public renew(): never {
    throw new GoneException('CHAT_CHECKOUT_REQUIRED');
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
