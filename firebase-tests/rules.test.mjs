import {before, after, test} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertSucceeds, assertFails} from '@firebase/rules-unit-testing';
import {doc, setDoc, getDoc, deleteDoc, collection, getDocs, serverTimestamp} from 'firebase/firestore';
import {ref, uploadBytes, getBytes} from 'firebase/storage';
let env;
before(async()=>{
  env=await initializeTestEnvironment({projectId:'demo-todo',
    firestore:{rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')},
    storage:{rules:readFileSync(new URL('../storage.rules',import.meta.url),'utf8')}});
});
after(async()=>env?.cleanup());
const record=(payload='{"id":"a","title":"Essay"}')=>({kind:'task',payload,deleted:false,updatedAt:serverTimestamp()});
test('owner creates, reads, updates and lists private records',async()=>{
 const db=env.authenticatedContext('alice').firestore(); const target=doc(db,'users/alice/records/task:a');
 await assertSucceeds(setDoc(target,record())); await assertSucceeds(getDoc(target));
 await assertSucceeds(setDoc(target,record('{"title":"Changed"}')));
 await assertSucceeds(getDocs(collection(db,'users/alice/records')));
});
test('anonymous and other accounts cannot read, query or write',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('bob')]){
  const db=context.firestore();const target=doc(db,'users/alice/records/task:a');
  await assertFails(getDoc(target));await assertFails(setDoc(target,record()));
  await assertFails(getDocs(collection(db,'users/alice/records')));
 }
});
test('both creates and updates reject invalid envelopes',async()=>{
 const db=env.authenticatedContext('alice').firestore();
 for(const id of ['task:new','task:a']){
  const target=doc(db,`users/alice/records/${id}`);
  await assertFails(setDoc(target,{...record(),extra:true}));
  await assertFails(setDoc(target,{...record(),payload:42}));
  await assertFails(setDoc(target,{...record(),payload:'x'.repeat(700001)}));
  await assertFails(setDoc(target,{...record(),deleted:'true'}));
  await assertFails(setDoc(target,{...record(),kind:'admin'}));
  await assertFails(setDoc(target,{...record(),updatedAt:new Date(0)}));
  await assertFails(setDoc(target,{kind:'task',payload:'{}'}));
 }
});
test('deletion must be a tombstone and arbitrary paths are denied',async()=>{
 const db=env.authenticatedContext('alice').firestore();const target=doc(db,'users/alice/records/task:a');
 await assertFails(deleteDoc(target));
 await assertFails(setDoc(target,{...record(),deleted:true}));
 await assertSucceeds(setDoc(target,{...record(''),deleted:true}));
 await assertFails(setDoc(doc(db,'users/alice/admin/settings'),record()));
 await assertFails(setDoc(doc(db,'users/alice/records/note:mismatch'),record()));
});
test('attachments are owner scoped with size limits',async()=>{
 const storage=env.authenticatedContext('alice').storage();
 const path='users/alice/attachments/note-a/file-a';
 await assertSucceeds(uploadBytes(ref(storage,path),new Uint8Array([1,2,3]),{contentType:'application/pdf'}));
 await assertSucceeds(getBytes(ref(storage,path)));
 await assertFails(getBytes(ref(env.authenticatedContext('bob').storage(),path)));
 await assertFails(uploadBytes(ref(env.authenticatedContext('bob').storage(),path),new Uint8Array([0])));
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),path)));
 await assertFails(uploadBytes(ref(storage,'users/alice/attachments/note-a/large'),new Uint8Array(20*1024*1024+1),{contentType:'application/pdf'}));
});
