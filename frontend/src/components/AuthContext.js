import { createContext } from 'react';

export const AuthContext = createContext(
  /** @type {{authenticated:boolean,email:string|null,role:string|null}|null} */ (null),
);
