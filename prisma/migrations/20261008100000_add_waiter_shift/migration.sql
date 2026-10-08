-- CreateWaiterShift model
CREATE TABLE "WaiterShift" (
    "id" UUID NOT NULL,
    "waiterId" TEXT NOT NULL,
    "checkInTime" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "totalHours" DOUBLE PRECISION,
    "date" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaiterShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WaiterShift_waiterId_date_idx" ON "WaiterShift"("waiterId", "date");
CREATE INDEX "WaiterShift_waiterId_checkInTime_idx" ON "WaiterShift"("waiterId", "checkInTime");

ALTER TABLE "WaiterShift" ADD CONSTRAINT "WaiterShift_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "User"("id") ON DELETE CASCADE NOT VALID;
ALTER TABLE "WaiterShift" VALIDATE CONSTRAINT "WaiterShift_waiterId_fkey";
