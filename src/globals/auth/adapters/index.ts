/**
 * Database adapters for BlueLibs Runner Authentication System
 * 
 * These adapters provide concrete implementations of IUserStore for popular databases.
 * Use them to integrate the auth system with your existing database infrastructure.
 */

export { MongoUserStore } from "./MongoUserStore";
export { PostgresUserStore } from "./PostgresUserStore";

// Re-export types for convenience
export type {
  IUser,
  IUserStore,
  IUserRegistration,
  IUserWithPassword,
} from "../types";