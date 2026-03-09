import { runtimeRecoverWhenRequiresPausedStateError } from "../../errors";
import type {
  IRuntimeRecoveryHandle,
  IRuntimeRecoveryOptions,
  RuntimeState,
} from "../../types/runner";
import type { ITimerHandle, ITimers } from "../../types/timers";
import type { OnUnhandledError } from "../UnhandledError";
import { safeReportUnhandledError } from "../UnhandledError";

type RuntimeRecoveryRegistration = {
  cancel: () => void;
  episode: number;
  id: string;
  satisfied: boolean;
};

type RuntimeRecoveryControllerOptions = {
  getRuntimeState: () => RuntimeState;
  getTimers: () => ITimers;
  isShuttingDown: () => boolean;
  onResume: () => void;
  onUnhandledError: OnUnhandledError;
};

export class RuntimeRecoveryController {
  private pauseEpisode = 0;
  private recoveryCounter = 0;
  private readonly registrations = new Map<
    string,
    RuntimeRecoveryRegistration
  >();

  constructor(private readonly options: RuntimeRecoveryControllerOptions) {}

  public beginPauseEpisode(): void {
    this.pauseEpisode += 1;
    this.clear();
  }

  public resumeCurrentEpisode(): void {
    this.clear();
    this.options.onResume();
  }

  public recoverWhen(
    recoveryOptions: IRuntimeRecoveryOptions,
  ): IRuntimeRecoveryHandle {
    if (this.options.getRuntimeState() !== "paused") {
      runtimeRecoverWhenRequiresPausedStateError.throw();
    }

    const id = recoveryOptions.id ?? `recovery-${++this.recoveryCounter}`;
    this.registrations.get(id)?.cancel();

    const episode = this.pauseEpisode;
    const intervalHandleRef: { current?: ITimerHandle } = {};
    const cancel = () => {
      intervalHandleRef.current?.cancel();
      this.registrations.delete(id);
    };
    const registration: RuntimeRecoveryRegistration = {
      id,
      episode,
      satisfied: false,
      cancel,
    };

    const evaluate = async () => {
      if (
        this.options.isShuttingDown() ||
        registration.episode !== this.pauseEpisode
      ) {
        return;
      }

      try {
        registration.satisfied = await recoveryOptions.check();
      } catch (error) {
        registration.satisfied = false;
        await safeReportUnhandledError(this.options.onUnhandledError, {
          error,
          kind: "run",
          source: `runtime.recoverWhen:${id}`,
        });
      }

      this.tryAutoResume();
    };

    intervalHandleRef.current = this.options
      .getTimers()
      .setInterval(async () => {
        await evaluate();
      }, recoveryOptions.everyMs);

    this.registrations.set(id, registration);
    void evaluate();

    return {
      id,
      cancel: registration.cancel,
    };
  }

  public dispose(): void {
    this.clear();
  }

  private clear(): void {
    for (const registration of Array.from(this.registrations.values())) {
      registration.cancel();
    }
    this.registrations.clear();
  }

  private tryAutoResume(): void {
    if (this.options.getRuntimeState() !== "paused") {
      return;
    }

    if (this.registrations.size === 0) {
      return;
    }

    for (const registration of this.registrations.values()) {
      if (
        registration.episode !== this.pauseEpisode ||
        registration.satisfied !== true
      ) {
        return;
      }
    }

    this.resumeCurrentEpisode();
  }
}
