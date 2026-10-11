-- Additive migration: preserve orders, item quantities, prices and all payments.
ALTER TABLE "Table" ADD COLUMN "assignedWaiterId" TEXT;
ALTER TABLE "Table" ADD CONSTRAINT "Table_assignedWaiterId_fkey" FOREIGN KEY ("assignedWaiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MenuItem" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "unavailableReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "noteAcknowledgedAt" TIMESTAMP(3), ADD COLUMN "noteAcknowledgedById" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "pickedUpAt" TIMESTAMP(3), ADD COLUMN "deliveredAt" TIMESTAMP(3), ADD COLUMN "noteAcknowledgedAt" TIMESTAMP(3), ADD COLUMN "noteAcknowledgedById" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "cancelledQuantity" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "WaiterCall" ADD COLUMN "acceptedAt" TIMESTAMP(3), ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE TABLE "ServiceRequest" (
 "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "orderItemId" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "quantity" DECIMAL(65,30) NOT NULL, "reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'KUTILMOQDA', "requestedById" TEXT NOT NULL,
 "decidedById" TEXT, "decisionReason" TEXT, "stockDisposition" TEXT NOT NULL DEFAULT 'DISCARD',
 "restockInventoryId" TEXT, "restockQuantity" DECIMAL(65,30), "refundId" TEXT,
 "amount" DECIMAL(65,30) NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "decidedAt" TIMESTAMP(3),
 CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ServiceRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ServiceRequest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServiceRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ServiceRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServiceRequest_refundId_key" ON "ServiceRequest"("refundId");
CREATE INDEX "ServiceRequest_orderId_status_idx" ON "ServiceRequest"("orderId", "status");
CREATE INDEX "ServiceRequest_status_createdAt_idx" ON "ServiceRequest"("status", "createdAt");
