- fix that bit with .with({})
- should middleware work for resources as well?

- run(root, {

  - debug: true // logs everything.
  - [app.user.id]
  - onError: (data, deps) => {
    - error.error
    - { task, resource, event, middleware }
  - }

- ability to use override: []
- introduce locking system to freeze all configs, all dependencies all everything.
