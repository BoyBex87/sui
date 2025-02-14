// Copyright (c) Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

import { bcs, decodeStr, encodeStr } from '@mysten/bcs';
import { Buffer } from 'buffer';
import { SuiObjectRef } from './objects';

bcs
  .registerVectorType('vector<u8>', 'u8')
  .registerVectorType('vector<u16>', 'u16')
  .registerVectorType('vector<u32>', 'u32')
  .registerVectorType('vector<u64>', 'u64')
  .registerVectorType('vector<u128>', 'u128')
  .registerVectorType('vector<u256>', 'u256')
  .registerVectorType('vector<vector<u8>>', 'vector<u8>')
  .registerAddressType('ObjectID', 20)
  .registerAddressType('SuiAddress', 20)
  .registerAddressType('address', 20)
  .registerType(
    'utf8string',
    (writer, str) => {
      let bytes = Array.from(Buffer.from(str));
      return writer.writeVec(bytes, (writer, el) => writer.write8(el));
    },
    (reader) => {
      let bytes = reader.readVec((reader) => reader.read8());
      return Buffer.from(bytes).toString('utf-8');
    }
  )
  .registerType(
    'ObjectDigest',
    (writer, str) => {
      let bytes = Array.from(decodeStr(str, 'base64'));
      return writer.writeVec(bytes, (writer, el) => writer.write8(el));
    },
    (reader) => {
      let bytes = reader.readVec((reader) => reader.read8());
      return encodeStr(new Uint8Array(bytes), 'base64');
    }
  );

bcs.registerStructType('SuiObjectRef', {
  objectId: 'ObjectID',
  version: 'u64',
  digest: 'ObjectDigest',
});

/**
 * Transaction type used for transferring objects.
 * For this transaction to be executed, and `SuiObjectRef` should be queried
 * upfront and used as a parameter.
 */
export type TransferObjectTx = {
  TransferObject: {
    recipient: string;
    object_ref: SuiObjectRef;
  };
};

bcs.registerStructType('TransferObjectTx', {
  recipient: 'SuiAddress',
  object_ref: 'SuiObjectRef',
});

/**
 * Transaction type used for transferring Sui.
 */
export type TransferSuiTx = {
  TransferSui: {
    recipient: string;
    amount: { Some: number } | { None: null };
  };
};

/**
 * Transaction type used for Pay transaction.
 */
export type PayTx = {
  Pay: {
    coins: SuiObjectRef[];
    recipients: string[];
    amounts: number[];
  };
};

export type PaySuiTx = {
  PaySui: {
    coins: SuiObjectRef[];
    recipients: string[];
    amounts: number[];
  };
};

export type PayAllSuiTx = {
  PayAllSui: {
    coins: SuiObjectRef[];
    recipient: string;
  };
};

bcs
  .registerVectorType('vector<SuiAddress>', 'SuiAddress')
  .registerVectorType('vector<SuiObjectRef>', 'SuiObjectRef')
  .registerStructType('PayTx', {
    coins: 'vector<SuiObjectRef>',
    recipients: 'vector<SuiAddress>',
    amounts: 'vector<u64>',
  });

bcs.registerStructType('PaySuiTx', {
  coins: 'vector<SuiObjectRef>',
  recipients: 'vector<SuiAddress>',
  amounts: 'vector<u64>',
});

bcs.registerStructType('PayAllSuiTx', {
  coins: 'vector<SuiObjectRef>',
  recipient: 'SuiAddress',
});

bcs.registerEnumType('Option<u64>', {
  None: null,
  Some: 'u64',
});

bcs.registerStructType('TransferSuiTx', {
  recipient: 'SuiAddress',
  amount: 'Option<u64>',
});

/**
 * Transaction type used for publishing Move modules to the Sui.
 * Should be already compiled using `sui-move`, example:
 * ```
 * $ sui-move build
 * $ cat build/project_name/bytecode_modules/module.mv
 * ```
 * In JS:
 * ```
 * let file = fs.readFileSync('./move/build/project_name/bytecode_modules/module.mv');
 * let bytes = Array.from(bytes);
 * let modules = [ bytes ];
 *
 * // ... publish logic ...
 * ```
 *
 * Each module should be represented as a sequence of bytes.
 */
export type PublishTx = {
  Publish: {
    modules: ArrayLike<ArrayLike<number>>;
  };
};

bcs.registerStructType('PublishTx', {
  modules: 'vector<vector<u8>>',
});

// ========== Move Call Tx ===========

/**
 * A reference to a shared object.
 */
export type SharedObjectRef = {
  /** Hex code as string representing the object id */
  objectId: string;

  /** The version the object was shared at */
  initialSharedVersion: number;
};

/**
 * An object argument.
 */
export type ObjectArg =
  | { ImmOrOwned: SuiObjectRef }
  | { Shared: SharedObjectRef }
  | { Shared_Deprecated: string };

/**
 * An argument for the transaction. It is a 'meant' enum which expects to have
 * one of the optional properties. If not, the BCS error will be thrown while
 * attempting to form a transaction.
 *
 * Example:
 * ```js
 * let arg1: CallArg = { Object: { Shared: {
 *   objectId: '5460cf92b5e3e7067aaace60d88324095fd22944',
 *   initialSharedVersion: 1,
 * } } };
 * let arg2: CallArg = { Pure: bcs.set(bcs.STRING, 100000).toBytes() };
 * let arg3: CallArg = { Object: { ImmOrOwned: {
 *   objectId: '4047d2e25211d87922b6650233bd0503a6734279',
 *   version: 1,
 *   digest: 'bCiANCht4O9MEUhuYjdRCqRPZjr2rJ8MfqNiwyhmRgA='
 * } } };
 * ```
 *
 * For `Pure` arguments BCS is required. You must encode the values with BCS according
 * to the type required by the called function. Pure accepts only serialized values
 */
export type CallArg =
  | { Pure: ArrayLike<number> }
  | { Object: ObjectArg }
  | { ObjVec: ArrayLike<ObjectArg> };

bcs
  .registerStructType('SharedObjectRef', {
    objectId: 'ObjectID',
    initialSharedVersion: 'u64',
  })
  .registerEnumType('ObjectArg', {
    ImmOrOwned: 'SuiObjectRef',
    Shared: 'SharedObjectRef',
  })
  .registerVectorType('vector<ObjectArg>', 'ObjectArg')
  .registerEnumType('CallArg', {
    Pure: 'vector<u8>',
    Object: 'ObjectArg',
    ObjVec: 'vector<ObjectArg>',
  });

/**
 * Kind of a TypeTag which is represented by a Move type identifier.
 */
export type StructTag = {
  address: string;
  module: string;
  name: string;
  typeParams: TypeTag[];
};

/**
 * Sui TypeTag object. A decoupled `0x...::module::Type<???>` parameter.
 */
export type TypeTag =
  | { bool: null }
  | { u8: null }
  | { u16: null }
  | { u32: null }
  | { u64: null }
  | { u128: null }
  | { u256: null }
  | { address: null }
  | { signer: null }
  | { vector: TypeTag }
  | { struct: StructTag };

bcs
  .registerEnumType('TypeTag', {
    bool: null,
    u8: null,
    u16: null,
    u32: null,
    u64: null,
    u128: null,
    u256: null,
    address: null,
    signer: null,
    vector: 'TypeTag',
    struct: 'StructTag',
  })
  .registerVectorType('vector<TypeTag>', 'TypeTag')
  .registerStructType('StructTag', {
    address: 'SuiAddress',
    module: 'string',
    name: 'string',
    typeParams: 'vector<TypeTag>',
  });

/**
 * Transaction type used for calling Move modules' functions.
 * Should be crafted carefully, because the order of type parameters and
 * arguments matters.
 */
export type MoveCallTx = {
  Call: {
    package: SuiObjectRef;
    module: string;
    function: string;
    typeArguments: TypeTag[];
    arguments: CallArg[];
  };
};

bcs
  .registerVectorType('vector<CallArg>', 'CallArg')
  .registerStructType('MoveCallTx', {
    package: 'SuiObjectRef',
    module: 'string',
    function: 'string',
    typeArguments: 'vector<TypeTag>',
    arguments: 'vector<CallArg>',
  });

// ========== TransactionData ===========

export type Transaction =
  | MoveCallTx
  | PayTx
  | PaySuiTx
  | PayAllSuiTx
  | PublishTx
  | TransferObjectTx
  | TransferSuiTx;

bcs.registerEnumType('Transaction', {
  TransferObject: 'TransferObjectTx',
  Publish: 'PublishTx',
  Call: 'MoveCallTx',
  TransferSui: 'TransferSuiTx',
  Pay: 'PayTx',
  PaySui: 'PaySuiTx',
  PayAllSui: 'PayAllSuiTx',
});
/**
 * Transaction kind - either Batch or Single.
 *
 * Can be improved to change serialization automatically based on
 * the passed value (single Transaction or an array).
 */
export type TransactionKind =
  | { Single: Transaction }
  | { Batch: Transaction[] };

bcs
  .registerVectorType('vector<Transaction>', 'Transaction')
  .registerEnumType('TransactionKind', {
    Single: 'Transaction',
    Batch: 'vector<Transaction>',
  });

/**
 * The TransactionData to be signed and sent to the RPC service.
 *
 * Field `sender` is made optional as it can be added during the signing
 * process and there's no need to define it sooner.
 */
export type TransactionData = {
  sender?: string; //
  gasBudget: number;
  gasPrice: number;
  kind: TransactionKind;
  gasPayment: SuiObjectRef;
};

bcs.registerStructType('TransactionData', {
  kind: 'TransactionKind',
  sender: 'SuiAddress',
  gasPayment: 'SuiObjectRef',
  gasPrice: 'u64',
  gasBudget: 'u64',
});

// ========== Deprecated ===========

/**
 * Temporary support for older protocol types that don't require an initial
 * shared version to be provided when referring to a shared object.  Remove
 * after the devnet launch that adds support for the new protocol.
 */
bcs
  .registerEnumType('ObjectArg_Deprecated', {
    ImmOrOwned: 'SuiObjectRef',
    Shared_Deprecated: 'ObjectID',
  })
  .registerVectorType('vector<ObjectArg_Deprecated>', 'ObjectArg_Deprecated')
  .registerEnumType('CallArg_Deprecated', {
    Pure: 'vector<u8>',
    Object: 'ObjectArg_Deprecated',
    ObjVec: 'vector<ObjectArg_Deprecated>',
  })
  .registerVectorType('vector<CallArg_Deprecated>', 'CallArg_Deprecated')
  .registerStructType('MoveCallTx_Deprecated', {
    package: 'SuiObjectRef',
    module: 'string',
    function: 'string',
    typeArguments: 'vector<TypeTag>',
    arguments: 'vector<CallArg_Deprecated>',
  })
  .registerEnumType('Transaction_Deprecated', {
    TransferObject: 'TransferObjectTx',
    Publish: 'PublishTx',
    Call: 'MoveCallTx_Deprecated',
    TransferSui: 'TransferSuiTx',
    Pay: 'PayTx',
    PaySui: 'PaySuiTx',
    PayAllSui: 'PayAllSuiTx',
  })
  .registerVectorType(
    'vector<Transaction_Deprecated>',
    'Transaction_Deprecated'
  )
  .registerEnumType('TransactionKind_Deprecated', {
    Single: 'Transaction_Deprecated',
    Batch: 'vector<Transaction_Deprecated>',
  })
  .registerStructType('TransactionData_Deprecated', {
    kind: 'TransactionKind_Deprecated',
    sender: 'SuiAddress',
    gasPayment: 'SuiObjectRef',
    gasPrice: 'u64',
    gasBudget: 'u64',
  });

export { bcs };
