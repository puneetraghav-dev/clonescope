#include <stdio.h>
#define MAXN 100
#define IS_EVEN(x) ((x) % 2 == 0)

int main() {
    int count, values[MAXN];
    int idx = 0, acc = 0, top, bottom, runner = 0, gotRunner = 0, evenCount = 0, mirror = 1;
    scanf("%d", &count);
    do {
        scanf("%d", &values[idx]);
        idx++;
    } while (idx < count);
    top = bottom = values[0];
    idx = 0;
    do {
        acc += values[idx];
        top = values[idx] > top ? values[idx] : top;
        bottom = values[idx] < bottom ? values[idx] : bottom;
        evenCount += IS_EVEN(values[idx]) ? 1 : 0;
        idx++;
    } while (idx < count);
    for (idx = 0; idx < count; idx++) {
        if (values[idx] == top) continue;
        if (!gotRunner || values[idx] > runner) {
            runner = values[idx];
            gotRunner = 1;
        }
    }
    printf("Sum: %d\n", acc);
    printf("Average: %.2f\n", acc * 1.0 / count);
    printf("Max: %d\n", top);
    printf("Min: %d\n", bottom);
    gotRunner ? printf("Second largest: %d\n", runner) : printf("Second largest: none\n");
    printf("Even: %d Odd: %d\n", evenCount, count - evenCount);
    printf("Reversed:");
    idx = count;
    do {
        idx--;
        printf(" %d", values[idx]);
    } while (idx > 0);
    printf("\n");
    for (idx = 0; idx < count / 2; idx++)
        if (values[idx] != values[count - 1 - idx]) mirror = 0;
    printf("Palindrome: %s\n", mirror ? "Yes" : "No");
    return 0;
}
