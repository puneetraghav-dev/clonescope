#include <stdio.h>

int main(void) {
	int z;
	int baz;
	int total;
	int num2;
	int small;
	int foo;
	int c;
	int key;
	int y;
	int var1;
	int elements[100];
	scanf("%d", &z);
	baz=0;
	while (baz<z) {
		scanf("%d", &elements[baz]);
		baz=baz+1;
	}
	total=0; key=0; y=0;
	num2=elements[0]; small=elements[0];
	baz=0;
	while (baz<z) {
		total=total+elements[baz];
		if (elements[baz]>num2) num2=elements[baz];
		if (elements[baz]<small) small=elements[baz];
		if (elements[baz]%2==0) key=key+1; else y=y+1;
		baz=baz+1;
	}
	c=0; foo=0;
	baz=0;
	while (baz<z) {
		if (elements[baz]<num2) {
			if (c==0||elements[baz]>foo) { foo=elements[baz]; c=1; }
		}
		baz=baz+1;
	}
	printf("Sum: %d\n", total);
	printf("Average: %.2f\n", total/(double)z);
	printf("Max: %d\n", num2);
	printf("Min: %d\n", small);
	if (c==1) printf("Second largest: %d\n", foo);
	else printf("Second largest: none\n");
	printf("Even: %d Odd: %d\n", key, y);
	printf("Reversed:");
	baz=z-1;
	while (baz>=0) { printf(" %d", elements[baz]); baz=baz-1; }
	printf("\n");
	var1=1;
	baz=0;
	while (baz<z/2) { if (elements[baz]!=elements[z-1-baz]) var1=0; baz=baz+1; }
	if (var1) printf("Palindrome: Yes\n"); else printf("Palindrome: No\n");
	return 0;
}
