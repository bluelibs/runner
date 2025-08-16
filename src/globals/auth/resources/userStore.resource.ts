import { defineResource } from "../../../define";
import { IAuthConfig } from "../types";
import { MemoryUserStore } from "../stores/MemoryUserStore";

/**
 * User store resource that provides an abstract interface for user persistence
 * By default uses MemoryUserStore, but can be overridden with any IUserStore implementation
 */
export const userStoreResource = defineResource({
  id: "globals.auth.resources.userStore",
  init: async (config: { store?: any } = {}) => {
    // If a custom store is provided, use it
    if (config.store) {
      return config.store;
    }
    
    // Default to memory store
    return new MemoryUserStore();
  },
  meta: {
    title: "User Store",
    description: "Provides user persistence and management functionality",
    tags: ["auth", "storage"],
  },
});