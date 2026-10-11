// Sample content shown on first launch. Public-domain excerpts.
export const SEED_BOOKS = [
  { id: 'b1', title: 'Pride and Prejudice', author: 'Jane Austen', color: '#E8605C', tags: ['Romance'], image: '', showText: true, chapter: 0,
    chapters: [
      { title: 'Chapter I', paras: [
        'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.',
        'However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.',
        '“My dear Mr. Bennet,” said his lady to him one day, “have you heard that Netherfield Park is let at last?”',
        'Mr. Bennet replied that he had not.'] },
      { title: 'Chapter II', paras: ['Mr. Bennet was among the earliest of those who waited on Mr. Bingley.'] },
    ] },
  { id: 'b2', title: 'Moby-Dick', author: 'Herman Melville', color: '#46668F', tags: ['Adventure'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'Loomings', paras: ['Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world.'] }] },
  { id: 'b3', title: 'Alice in Wonderland', author: 'Lewis Carroll', color: '#8C7BC4', tags: ['Fantasy'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'Down the Rabbit-Hole', paras: ['Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”'] }] },
  { id: 'b4', title: 'Jane Eyre', author: 'Charlotte Brontë', color: '#5BA56B', tags: ['Romance'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'Chapter I', paras: ['There was no possibility of taking a walk that day.'] }] },
  { id: 'b5', title: 'Frankenstein', author: 'Mary Shelley', color: '#3E8A8C', tags: ['Gothic'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'Letter 1', paras: ['You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.'] }] },
  { id: 'b6', title: 'A Tale of Two Cities', author: 'Charles Dickens', color: '#F2B33D', tags: ['Classic'], image: '', showText: true, chapter: 0,
    chapters: [{ title: 'The Period', paras: ['It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness…'] }] },
];

// Sample CDs have placeholder running times and no audio files.
// Tapping one opens the editor so an audio file can be attached.
export const SEED_AUDIO = [
  { id: 'a1', title: 'The Odyssey', author: 'Homer', color: '#8C7BC4', tags: ['Adventure'], image: '', showText: true, tracks: [], len: 43200, pos: 15600 },
  { id: 'a2', title: 'Dracula', author: 'Bram Stoker', color: '#3E8A8C', tags: ['Gothic'], image: '', showText: true, tracks: [], len: 55800, pos: 36600 },
  { id: 'a3', title: 'Emma', author: 'Jane Austen', color: '#E9A6A0', tags: ['Romance'], image: '', showText: true, tracks: [], len: 57600, pos: 4800 },
  { id: 'a4', title: 'The Secret Garden', author: 'F. H. Burnett', color: '#5BA56B', tags: ['Fantasy'], image: '', showText: true, tracks: [], len: 31200, pos: 0 },
  { id: 'a5', title: 'Great Expectations', author: 'Charles Dickens', color: '#F2B33D', tags: ['Classic'], image: '', showText: true, tracks: [], len: 66000, pos: 22000 },
];

// Starter tags. Users can add their own and delete any of these.
export const SEED_TAGS = [
  { name: 'Romance', color: '#E8605C' },
  { name: 'Adventure', color: '#46668F' },
  { name: 'Classic', color: '#8A6A5A' },
  { name: 'Fantasy', color: '#8C7BC4' },
  { name: 'Gothic', color: '#3E8A8C' },
];
