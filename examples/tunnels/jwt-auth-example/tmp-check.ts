import type { ITag } from '@bluelibs/runner';
import type { ITag as NodeITag } from '@bluelibs/runner/node';
type Check = NodeITag extends ITag ? true : false;
