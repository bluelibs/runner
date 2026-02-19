# Framework Comparison

> Detailed side-by-side comparison of Runner with NestJS, Effect, and DI-only containers. For the quick matrix, see the [Getting Started](#how-does-it-compare) section.

---

## Side-by-Side: The Same Feature in Both Frameworks

Let's compare implementing the same user service in Runner and NestJS:

<table>
<tr>
<td width="50%" valign="top">

**NestJS Approach** (~45 lines)

```typescript
// user.dto.ts
import { IsString, IsEmail } from "class-validator";

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;
}

// user.service.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private readonly mailer: MailerService,
    private readonly logger: LoggerService,
  ) {}

  async createUser(dto: CreateUserDto) {
    const user = await this.userRepo.save(dto);
    await this.mailer.sendWelcome(user.email);
    this.logger.log(`Created user ${user.id}`);
    return user;
  }
}

// user.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserService, MailerService],
  controllers: [UserController],
})
export class UserModule {}
```

</td>
<td width="50%" valign="top">

**Runner Approach** (~25 lines)

```typescript
// users.ts
import { r, globals } from "@bluelibs/runner";
import { z } from "zod";

const createUser = r
  .task("users.create")
  .dependencies({
    db,
    mailer,
    logger: globals.resources.logger,
  })
  .inputSchema(
    z.object({
      name: z.string(),
      email: z.string().email(),
    }),
  )
  .run(async (input, { db, mailer, logger }) => {
    const user = await db.users.insert(input);
    await mailer.sendWelcome(user.email);
    await logger.info(`Created user ${user.id}`);
    return user;
  })
  .build();

// Register in app
const app = r.resource("app").register([db, mailer, createUser]).build();
```

</td>
</tr>
<tr>
<td>

**Unit Testing in NestJS:**

```typescript
describe("UserService", () => {
  it("creates user", async () => {
    // Direct instantiation - no module needed
    const service = new UserService(mockRepo, mockMailer, mockLogger);
    const result = await service.createUser({
      name: "Ada",
      email: "ada@test.com",
    });
    expect(result.id).toBeDefined();
  });
});
```

**Integration Testing in NestJS:**

```typescript
describe("UserService (integration)", () => {
  let service: UserService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useFactory: mockRepository },
        { provide: MailerService, useValue: mockMailer },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(UserService);
  });

  it("creates user through DI", async () => {
    const result = await service.createUser({
      name: "Ada",
      email: "ada@test.com",
    });
    expect(result.id).toBeDefined();
  });
});
```

</td>
<td valign="top">

**Unit Testing in Runner:**

```typescript
describe("createUser", () => {
  it("creates user", async () => {
    // Direct call - bypasses middleware
    const result = await createUser.run(
      { name: "Ada", email: "ada@test.com" },
      {
        db: mockDb,
        mailer: mockMailer,
        logger: mockLogger,
      },
    );
    expect(result.id).toBeDefined();
  });
});
```

**Integration Testing in Runner:**

```typescript
describe("createUser (integration)", () => {
  it("creates user through full pipeline", async () => {
    // r.override(base, fn) builds replacement definitions
    // .overrides([...]) applies them in this test container
    const testApp = r
      .resource("test")
      .register([app])
      .overrides([
        r.override(db, async () => mockDb),
        r.override(mailer, async () => mockMailer),
      ])
      .build();

    const { runTask, dispose } = await run(testApp);
    const result = await runTask(createUser, {
      name: "Ada",
      email: "ada@test.com",
    });
    expect(result.id).toBeDefined();
    await dispose();
  });
});
```

</td>
</tr>
</table>

---

## Detailed Capability Comparison

| Capability      | NestJS                                       | Runner                                                                 |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| **Reliability** | Add external libs (e.g., `nestjs-retry`)     | Built-in: retry, circuit breaker, rate limit, cache, timeout, fallback |
| **Type Safety** | Manual typing for DI tokens                  | Full inference from `.dependencies()` and `.with()`                    |
| **Test Setup**  | `Test.createTestingModule()` boilerplate     | `task.run(input, mocks)` -- one line                                   |
| **Scope**       | Web framework (HTTP-centric)                 | Application toolkit (any TypeScript app)                               |
| **Middleware**  | Guards, interceptors, pipes (HTTP lifecycle) | Composable, type-safe, with journal introspection                      |
| **Concurrency** | Bring your own                               | Built-in Semaphore and Queue primitives                                |
| **Bundle Size** | Large (full framework)                       | Tree-shakable (import what you use)                                    |

> **TL;DR:** NestJS gives you a structured web framework with conventions. Runner gives you a composable toolkit with **production-ready reliability built in** -- you bring the structure that fits your app.

---

## Runner vs Effect (TypeScript)

Both Runner and Effect are functional-first and offer full type inference. They solve different problems:

| Aspect                | Runner                                        | Effect                                         |
| --------------------- | --------------------------------------------- | ---------------------------------------------- |
| **Core abstraction**  | Tasks (plain async functions) + Resources     | `Effect<A, E, R>` (algebraic effect wrapper)   |
| **Code style**        | Standard async/await                          | Generators or pipe-based combinators           |
| **Error model**       | `r.error()` typed helpers, `throws` contracts | Typed error channel (`E` in `Effect<A, E, R>`) |
| **DI**                | `.dependencies()` with full inference         | Layers and Services                            |
| **Lifecycle**         | `init` / `dispose` on resources               | Layer acquisition / release                    |
| **Middleware**        | First-class, composable, with journal         | Aspect-oriented via Layer composition          |
| **Durable Workflows** | Built-in (Node)                               | Not built-in                                   |
| **HTTP Tunnels**      | Built-in (Node server, any fetch client)      | Not built-in                                   |
| **Adoption path**     | Incremental -- wrap existing async functions  | Pervasive -- all code wrapped in `Effect`      |
| **Learning curve**    | Gentle (familiar async/await)                 | Steep (FP concepts: fibers, layers, schemas)   |

**Choose Runner** when you want production reliability primitives, familiar async/await, and incremental adoption. **Choose Effect** when you want algebraic effects, structured concurrency, and full compile-time error tracking at the cost of a steeper learning curve and pervasive wrapper types.
