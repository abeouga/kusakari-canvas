import { createContext } from 'react';

export const AuthContext = createContext(
  /** @type {{authenticated:boolean,email:string|null,accountType:string|null}|null} */ (null),
);
