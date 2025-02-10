import { useContext, withContext } from '../context';

describe('ApplicationContext', () => {
  it('should create and use application context', async () => {
    const context = { user: { name: 'John Doe' }, roles: ['admin'], isLoggedIn: true };

    const result = withContext(context, () => {
      const ctx = useContext();
      return ctx;
    });

    expect(result).toEqual(context);
  });

  it('should handle nested contexts', async () => {
    const context1 = { user: { name: 'John Doe' }, roles: ['admin'], isLoggedIn: true };
    const context2 = { user: { name: 'Jane Doe' }, roles: ['user'], isLoggedIn: false };

    const result = withContext(context1, () => {
      const ctx1 = useContext();
      expect(ctx1).toEqual(context1);

      return withContext(context2, () => {
        const ctx2 = useContext();
        return ctx2;
      });
    });

    expect(result).toEqual(context2);
  });

  it('should return undefined when no context is set', async () => {
    const result = useContext();
    expect(result).toBeUndefined();
  });
});
