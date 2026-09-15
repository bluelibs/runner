/**
 * Shared durable resource fork for the studio.
 *
 * Lives in a leaf module so workflow definitions and the server bootstrap
 * can both use it without import cycles. Stores and buses are created fresh
 * per boot inside `studioApp.bootStudio()` so tests stay isolated.
 */
import { durableResource } from "@bluelibs/runner/node";

export const durable = durableResource.fork("studioDurable");
